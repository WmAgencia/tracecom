# REGISTRO TÉCNICO PERMANENTE — ESTRATÉGIAS SELECIONADAS (IDs preservados)

> Objetivo: permitir, no futuro, saber exatamente o que cada nome significava e reproduzir cada estratégia sem depender de memória, relatório antigo ou interpretação. **Nomes/IDs atuais preservados** (renomeação acontecerá só depois, escolhida em conjunto).
> Todas as equações abaixo foram transcritas do **código efetivamente executado** nos experimentos: `index-profiles.mjs`, `index.mjs (signalsFor)`, `consolidado-6.cjs`, `consolidado-v7v8.cjs`, `v7-all.cjs`. Números históricos **reproduzidos dos artefatos** `consolidado-6.json`, `consolidado-v7v8.json`, `v7-all.json` antes de persistir — **todos conferem com a especificação recebida** (nenhuma divergência).

## Infraestrutura comum (todas as estratégias)

- **Candles 5s causais**: bucket = floor(t_ms/5000)·5000; O/H/L/C das observações REAIS aceitas (status=ACCEPTED, market_type=OTC, context_validation_status=VALID, mesmo ativo); sem síntese de preços.
- **RSI(14) simples**: g=Σ diffs positivas (últimos 14 intervalos), l=Σ|diffs negativas|; RSI = 100 − 100/(1+g/l); se l=0 → 100. **s = (55 − RSI)/45**.
- **Volatilidade vol(12)**: desvio-padrão dos últimos 12 retornos r_j=(c_j−c_{j−1})/c_{j−1}.
- **momentum(120s)** = (c_n − c_{n−24})/c_{n−24} (retorno de 24 candles).
- **Fibonacci**: janela = últimos 24 candles; hi=max(high), lo=min(low); fh=1º índice de hi, fl=1º de lo; **upSwing = (fl ≤ fh)**; range=hi−lo; **lv382** = upSwing ? hi−0,382·range : lo+0,382·range; **lv618** = upSwing ? hi−0,618·range : lo+0,618·range; zona = [min(lv382,lv618), max(...)]; **inZone = close ∈ zona**.
- **fibOk(direção)** = inZone E (BUY → upSwing; SELL → !upSwing).
- **ATR(14)** = média(high−low dos últimos 14 candles). **SMA20** = média dos 20 últimos closes.
- **Warm-up mínimo**: 31 candles na janela causal (série pode incluir histórico pré-coorte; eventos forward só com T0 ≥ início da coorte).
- **Horizonte**: decisões avaliadas em **T+45 e T+60**; liquidação = 1ª observação real em [T0+H, T0+H+30s], mesma sessão+segmento (fallback: sessão+ativo+OTC+VALID). **Nenhuma decisão conhece o futuro** (regression de causalidade PASS).
- **WAIT**: todo caso não coberto por BUY/SELL (sem trade). Empates/indefinição = WAIT.
- **Causalidade**: decisão persistida antes de T+45 existir (`now − T0 < 45s`).

## 1) V1+Fib — BALANCEADO (`reversion-v1-fib`)

- **Mecanismo**: reversão de exaustão em recuo saudável (RSI extremo + vol baixa + zona dourada + contexto de swing).
- **BUY**: `vol < 0,0009` E `s > 0,33` E `fib.upSwing = true` E `inZone = true`.
- **SELL**: `vol < 0,0009` E `s < −0,33` E `!upSwing` E `inZone = true`.
- **WAIT**: qualquer outro caso.
- **Referência/função**: `signalsFor(f, "reversion-v1-fib")` em `relay/index.mjs` (congelada).
- **Histórico (2.592 snapshots; T+60)**: 35 BUY / 2 SELL / 2.555 WAIT; **21W / 7L / 5D; WR 75,0% (n=28); Wilson 0,566–0,873; cobertura 1,43%**.
- **Fonte**: `consolidado-6.json` → confere com a especificação.

## 2) V3+Fib — AGRESSIVO (`reversion-v3-fib`)

- **Mecanismo**: V2+Fib + filtro de tendência de 120s alinhado ("comprar queda dentro de tendência de alta").
- **BUY**: `vol < 0,0012` E `s > 0,22` E `mom120 > 0` E `upSwing` E `inZone`.
- **SELL**: `vol < 0,0012` E `s < −0,22` E `mom120 < 0` E `!upSwing` E `inZone`.
- **WAIT**: caso contrário.
- **Referência**: `signalsFor(f, "reversion-v3-fib")` (congelada).
- **Histórico**: 48/9/2.535; **35W / 18L / 0D; WR 66,0% (n=53); Wilson 0,526–0,773; cobertura 2,20%**.
- **Fonte**: `consolidado-6.json` → confere.

## 3) V6+Fib — CONSERVADOR (`reversion-v6-fib`)

- **Mecanismo**: reversão em RSI profundamente extremo, excluindo o extremo terminal que historicamente falha.
- **BUY**: `vol < 0,0009` E `|s| ∈ [0,63; 0,857]` E `s > 0` E `upSwing` E `inZone`.
- **SELL**: `vol < 0,0009` E `|s| ∈ [0,63; 0,857]` E `s < 0` E `!upSwing` E `inZone`.
- **WAIT**: caso contrário.
- **Referência**: `decideV6Fib(f)` em `index-profiles.mjs` (congelada).
- **Histórico**: 5/0/2.587; **4W / 0L / 0D; WR histórico 100%; Wilson 0,510–1; cobertura 0,19%**.
- **⚠️ OBRIGATÓRIO**: **N insuficiente (n=4). Resultado promissor, NÃO validado.** Nunca citar como prova de 100%.

## 4) V7-AND — EXPERIMENTAL (`reversion-v7-and`)

- **Definição exata**: `ATR-Overshoot+Fib(3×ATR)` **E** `V1+Fib` **concordando na mesma direção** (senão WAIT).
- **ATR-Overshoot+Fib(M)**: `dir = SMA20 − close ≥ M·ATR ? "BUY" : close − SMA20 ≥ M·ATR ? "SELL" : "WAIT"` e então exigir `inZone` + contexto de swing na direção.
- **BUY**: componente ATR (3×) = BUY E V1+Fib = BUY. **SELL**: ambos = SELL. **WAIT**: qualquer divergência/ausência.
- **Referência**: `decideV7And(f, candles)` (`decideAtrFib` com mult=3 + `signalsFor` v1).
- **Histórico**: 19/0/2.573; **13W / 0L / 5D; WR direcional 100% (n=13); Wilson 0,772–1; cobertura 0,73%**.
- **⚠️ OBRIGATÓRIO**: **N=13 direcional — amostra insuficiente.** Promissor, não validado.

## 5) V7-Relaxado — EXPERIMENTAL (`reversion-v7-relaxed`)

- **Definição exata (retirada do código, NÃO inferida)**: união — `ATR-Overshoot+Fib(1×ATR)` **OU** `V1+Fib`; **conflito (direções opostas) → WAIT**; se um lado é WAIT, vale o outro; condições Fibonacci integralmente preservadas (`inZone` + contexto de swing em ambas as pernas).
- **Referência**: `decideV7Relaxed(f, candles)` (`decideAtrFib` com mult=1 + `signalsFor` v1).
- **Histórico**: 100 BUY / 66 SELL / 2.426 WAIT; **89W / 50L / 13D; N direcional 139; WR 64,0%; Wilson 0,558–0,715; cobertura 6,40%**.
- **Fonte**: `v7-all.json` (mesma definição validada por regressão contra `consolidado-v7v8.json`).

## Verificação de números (antes de persistir)
Todos os cinco conjuntos foram **reproduzidos dos artefatos** (`consolidado-6.json`, `consolidado-v7v8.json`, `v7-all.json`) e **conferem 100% com a especificação recebida** — nenhuma divergência a documentar. Coberturas recalculadas sobre os 2.592 snapshots elegíveis (de 3.212; 620 excluídos por warm-up < 31 candles).

## Coorte prospectiva (em execução)
- Run `fwdP_1789478431107` (AUD/CAD, início 13:20:31Z) — executor `index-profiles.mjs` versão de config **fwd-profiles-2.1.0** (V7s adicionadas; IDs preservados).
- Cada estratégia decide **independentemente** no mesmo snapshot causal; decisões persistidas **antes de T+45/T+60** existirem (`futureKnown=false`).
- Registro por decisão (`fwd_profile_decisions`): strategy_version (strategyId/version), decision, t0_ms, entry_price, observation_id, context_id, price_t45/result_45, price_t60/result_60.
- **Métricas separadas** por natureza (script `metrics-profiles.cjs`): **Hoje** · **Coorte acumulada** (+ Wilson) · **Discovery** (histórico acima) — **nunca somados**.
- **Regressão**: 2.592/2.592 = 100% de concordância BUY/SELL/WAIT nas 5 estratégias vs função de referência + **causalidade PASS** (mutação do futuro não altera decisões). Duas divergências encontradas e corrigidas durante a validação: (a) guard `atr<=0` inexistente na referência; (b) `f.last` ausente em `featuresAt` (o componente ATR lia `undefined`) — ambos corrigidos antes do deploy final.
- Incidente auditável: entre 13:52–14:39Z o executor ficou inativo (bug de autostart corrigido no commit de código; colunas v7 adicionadas no boot seguinte). Eventos desse intervalo não entram na coorte (sem backfill retroativo); v7 começa no 1º evento após 14:30Z.

## Camada de identidade visual e classificação (implementada em 15/09/2026)

> **Escopo**: APENAS apresentação. Nenhuma equação, threshold, versão congelada, tabela ou decisão foi alterada. `strategyId`/`strategy_version` internos permanecem idênticos em banco, relatórios e decisões antigas. Nomes visuais derivados da **implementação real**.

| ID interno (preservado) | Nome visual | Perfil (metadado) | Descrição curta |
|---|---|---|---|
| `reversion-v7-and` | **Fib Dual Exhaustion** | CONVICÇÃO MÁXIMA | Concordância entre overshoot de ATR (≥3×ATR da SMA20) e exaustão de RSI, ambos na zona dourada. |
| `reversion-v6-fib` | **Fib Deep Exhaustion** | CONSERVADORA | Exaustão profunda de RSI (banda 0,63–0,857), excluindo o extremo terminal, na zona dourada. |
| `reversion-v1-fib` | **Fib RSI Reversal** | BALANCEADA | Exaustão de RSI(14) em região estrutural de Fibonacci com volatilidade baixa (σ12<0,0009). |
| `reversion-v3-fib` | **Fib Trend Reversal** | AGRESSIVA | Reversão de RSI(14) alinhada à tendência de 120s, ancorada em Fibonacci (σ12<0,0012). |
| `reversion-v7-relaxed` | **Fib Adaptive Reversal** | ALTA FREQUÊNCIA | União adaptativa: overshoot de ATR (≥1×ATR) OU exaustão de RSI, em Fibonacci; conflito → WAIT. |

- **Regra**: `displayName` e `profile` são `METADADOS` de categoria — **não afirmam WR futuro** e **não mudam automaticamente** com resultados diários.
- **Frontend** (`src/http/public/app.js`, constante `STRATEGY_IDENTITY`, render `renderStrategyIdentityPanel()`): cartão mostra `Nome visual` + `Perfil`; dados secundários/tooltip exibem `ID interno (V7-AND etc.)`. Filtros visuais: **Todas | Convicção Máxima | Conservadora | Balanceada | Agressiva | Alta Frequência** — filtragem puramente visual, **sem seleção automática de estratégia**.
- **Regressão desta etapa**: 2.592/2.592 = 100,0% PASS nas 5 + causalidade PASS **após** a mudança de identidade/UI (comprovando 0 alterações em BUY/SELL/WAIT).
- Candidatos avaliados por estratégia (registro da decisão): V7-AND → "Twin Exhaustion Confluence", "Confluence Exhaustion" (escolhido: Fib Dual Exhaustion); V6+Fib → "Deep Band Reversal", "Core RSI Exhaustion" (escolhido: Fib Deep Exhaustion); V1+Fib → "Low-Vol RSI Reversal", "Fib Exhaustion Reversal" (escolhido: Fib RSI Reversal); V3+Fib → "Trend-Aligned Dips", "Fib Pullback Reversal" (escolhido: Fib Trend Reversal); V7-Relaxado → "Wide Fib Reversal", "Hybrid Exhaustion Reversal" (escolhido: Fib Adaptive Reversal).
- **Não implementado nesta etapa (conforme instrução)**: ranking automático, prioridade automática, escolha de estratégia por WR.
