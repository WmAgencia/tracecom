# MEMÓRIA DO BOT V16 (`ws-otc-v15.mjs`) — LEIA ISTO ANTES DE MEXER

> **Este arquivo é a memória do bot standalone do dono do projeto.** Toda sessão/agente que
> for alterar `ws-otc-v15.mjs`, `bot-config-v15.json` ou `iqoption-ws.mjs` lê isto **antes**.
> O que está escrito aqui foi decidido pelo dono e **não volta atrás sem pedido explícito dele**.
>
> A V14 (`ws-otc-v14.mjs`) continua no repositório **apenas como histórico** — a versão viva
> é a V16. Este bot é **separado** do motor oficial (`relay/`, estratégia V3 congelada em
> `AGENTS.md`). As regras de lá (ex.: martingale proibido no V3) **não** se aplicam a este
> script, e nada daqui pode ser copiado para o motor oficial.

---

## 1. Como rodar

```bash
cd "D:/Tracecom project"
node ws-otc-v15.mjs demo      # conta PRACTICE (id 1250741747, USD)
node ws-otc-v15.mjs real      # conta REAL (id 1250741746, BRL)
node ws-otc-v15.mjs           # pergunta: 1 = REAL | 2 = DEMO
node ws-otc-v15.mjs demo --ativos   # lista os ativos turbo disponíveis
```

- **O bot não recarrega sozinho.** Depois de qualquer alteração, **reiniciar**. O boot imprime
  `[🧬] CÓDIGO V16 sha256:xxxxxxxx` — se a tela mostrar outro hash, é código velho rodando.
- Testes: `node diagnostic-results/bot-v15-tests.mjs` (offline, nenhuma ordem — hoje 70/70).
  Replay com candles reais: `REAL=1 node diagnostic-results/bot-v15-tests.mjs` (login +
  get-candles, **zero ordens**).
- `IQ_WS_VERBOSE=1` liga o log detalhado do socket; `IQ_SELL_DEBUG=1` liga o dump cru da IQ
  nas janelas de venda (sem isso, silêncio total — o painel é a única saída viva).

---

## 2. As decisões do dono (o que ele quer)

| Assunto | Decisão | Onde |
|---|---|---|
| **Ativos operando** | **Sem limite expandido para 170+.** No mínimo **170 ativos operando** (`universe.minActive=170`, `maxActive=200`). Top 61 na whitelist + 26 na reserva; auto-fill completa com qualquer OTC turbo disponível. Revisão a cada 30s; ativo sem candle 5s por 3 min é substituído. | `universe`, `whitelist`, `reserve` |
| **Ordens por ativo** | **CICLO DE 3 ORDENS (regra do dono, 2026-10-02 — ver §15): 1 entrada + no máximo 1 pirâmide + 1 MARTINGALE.** A pirâmide (2ª posição no mesmo sentido) só sai na **chance quase perfeita de não reverter**: **ADX ≥ 25** + **RSI no extremo A FAVOR** (CALL ≤ 35 / PUT ≥ 65 — não é "não estar esticado", é estar esticado do lado oposto) + **sem reversão se formando** contra a posição. Fora desse quadro o bot faz **uma compra só**. Nunca CALL e PUT juntos (trava dura `ladoOposto`). | `evaluateEntry`, `strategy.pyramid*`, `trading.maxOpsPerAsset` |
| **Gatilho do gale** | **Depois de um loss** (a venda por reversão conta como loss quando o líquido é negativo) o bot volta no **mesmo ativo** em até `galeWindowMs`, **sem exigir pullback novo** *(ver §10: hoje o código exige fade4 — pendente)*. Direção = tendência do momento. | `trading.galeWindowMs` |
| **Valor** | **Fixo na base (2)** em toda ordem — a **ÚNICA exceção é o martingale**, que vale `2,75 × a exposição que está sendo recuperada` (uma posição de 2,00 → 5,50; duas → 11,00). Se definir base 4 → o martingale escala junto (5,5 × base). `martingale.levels: 0` (fora dele não existe escada). Ver §15. | `trading.baseStake`, `martingale.martingaleMultiplier` |
| **Direção** | **Tendência do mercado** (EMA8 × EMA21, spread ≥ 0,06%). Alta compra CALL no pullback; baixa vende PUT no repique; lateral não entra. | `strategy.trendMinEmaSpreadPct` |
| **RSI** | **Guarda-corpo mais apertado V16:** não compra com RSI > 55, não vende com RSI < 45 (era 60/40). | `strategy.rsiCallMax/rsiPutMin` |
| **ADX** | **NOVO V16:** ADX mínimo 20 — a tendência precisa ter força mínima para operar (não é só direção). ADX < 20 = mercado fraco/lateral, entrada proibida. **ADX = 0** (ativo sem histórico 1m suficiente) também bloqueia — não é "tendência fraca", é falta de dados. | `strategy.adxMin` |
| **Regime** | Bloqueia entrada com 12+ candles iguais seguidos. Pullback DENTRO da tendência é válido (check de pullback agora ANTES do regime) *(ver §10: o código hoje bloqueia trending mesmo com pullback — pendente)*. | `strategy.regimeStreakThreshold` |
| **VENDA** | **SÓ com CONFIRMAÇÃO DE REVERSÃO contra a posição (regra do dono, 2026-10-02 — ver §14).** `reversalAgainst` (tudo junto): tendência virou contra (EMA8×21) + RSI do lado oposto (CALL ≤ 45 / PUT ≥ 55) + ≥2/3 velas 5s contra + preço adverso ≥1× o candle típico (isso é o que impede vender ganhando). A venda é **A MERCADO** (a IQ só manda cotação no abrir/fechar; o valor sai no fechamento), fora dos últimos 20s, avaliada **1×/s**. **Depois de vender, entra no sentido NOVO** (o martingale, sem exigir pullback) valendo **2,75× a soma das posições vendidas**. O `sell_profit` do push é a **DEVOLUÇÃO da recompra** (líquido = devolução − stake). | `sell`, `sellDecision()`, `reversalAgainst()` |
| **Teto de exposição** | **Fração do saldo** (50%), nunca número absoluto. | `risk.maxExposurePct` |
| **Circuit breaker** | **REMOVIDO em V16.** O bot opera continuamente sem pausa por losses consecutivos. A única proteção contra perdas é a **trava de perda da sessão (20%)**. | `risk` (removido) |
| **Trava de perda da sessão** | Perdeu **20% do saldo inicial** (saldo no boot desta sessão) → para de abrir até reiniciar. As perdas de **sessões anteriores** não são carregadas — `sessionStartBalance` é definido no boot com o saldo atual, e `sessionLoss` começa em 0 a cada nova sessão. | `sessionStartBalance`, `sessionLoss` |
| **Painel** | Uma linha só, estilo **odômetro**: candles fechados, ops, W, L, vendas, WR, P/L, abertas, ativos rodando, pausa, relógio. Sem lista por ativo. | `dashboardText()` |
| **Warmup** | 5s (o histórico do boot já traz ~120 candles de 5s + 30 de 1m por ativo). **Boot paralelizado em chunks de 10 ativos** (`getCandlesHistory` em paralelo) — antes era sequencial e levava 3-4 minutos com 170 ativos; agora termina em segundos. | `strategy.warmupMs` |

---

## 3. Armadilhas já pagas (o dono perdeu dinheiro com isso — não repetir)

1. **`close-position` é ignorada em silêncio pela IQ.** A mensagem correta de venda antecipada é
   **`sell-options`** com `body: { options_ids: [id] }`. Há teste estático garantindo.
2. **Venda por reversão ARBITRÁRIA está proibida (v15) — mas a reversão CONFIRMADA é a regra
   nova (2026-10-02).** A regra velha vendia **qualquer** op perdendo depois de 2 candles
   contra, sem olhar valor/tempo/momentum — foi o que o dono viu ("vendeu uma operação
   negativa"). A regra do dono agora (§14): vende SÓ com **confirmação** de reversão contra a
   posição (tendência virou + RSI contrário + velas contra + distância adversa). Sem
   confirmação, o bot **espera**.
3. **`sell-equal` nunca chegou em nenhuma sessão registrada.** O fechamento por venda chega em
   **`socket-option-closed`** (a posição fecha ~10-45s depois do pedido). O handler de
   `sell-equal` existe só como reconciliação — o caminho principal é o closed antecipado.
4. **`sell_profit` NÃO é lucro: é a DEVOLUÇÃO da recompra** (medido ao vivo em 2026-10-02 no
   extrato `closed_options`: a IQ marca venda antecipada como `loose`/`equal`, nunca `win`; um
   win real devolve 3,64 para stake 2,00). O líquido = `devolução − stake` (`saleNet`). Gravar
   a devolução como lucro foi o bug corrigido em 2026-10-02.
5. **As vendas da R8 foram gravadas como −2 cheio** (4 posições fechadas 10s/20s/45s após abrir,
   `earlySell: false`) porque o bot nunca leu a cotação. A V15 lê ANTES de vender e grava a
   devolução + o líquido (devolução − stake); o resumo separa W/L pelo sinal.
6. **A V10 empilhava ordens no mesmo segundo no mesmo ativo** (ex.: 3 HYPE em 0,5s) — parte do
   "muitas operações simultâneas" dela era bug (68 ordens em 11,5 min, só 15 fechadas, −3,80 no
   relatório). **Não reintroduzir empilhamento.**
7. **A venda depende de reversão, não de cotação.** Em 2026-10-02 ficou provado que **não
existe cotação de meio de vida**: o push `portfolio.position-changed` v3.0 chega **1× por
posição** (na abertura; o fechamento vem em `socket-option-closed`) e o `get-options` v1.0 em
voo é estático (`open_options` sem `sell_profit`, `profit` sempre 0). Por isso a venda é **a
mercado** (decisão pela reversão; valor real lido no fechamento) e o `sell_profit` da abertura
fica só como fallback. Ver §13 e §14.
8. **Ordem sem ACK da IQ em 5s** agora avisa no log (ordem pode não ter chegado ao broker).
9. **`get-candles`: `to` é em SEGUNDOS** e a paginação não funciona (sempre vem 1000 candles).
10. **Um único ponto abre ordem** e **um único ponto pede venda** — testes estáticos garantem.

---

## 4. Backup (o cofre)

Toda alteração aprovada exige copiar os arquivos vivos para o cofre:

```bash
cp ws-otc-v15.mjs bot-config-v15.json BOT-V15-MEMORIA.md iqoption-ws.mjs README.bot.md oTrace.com/backup/
cp diagnostic-results/bot-v15-tests.mjs diagnostic-results/bot-v15-relatorio.md diagnostic-results/bot-v15-hidratacao-diag.mjs oTrace.com/backup/
```

- `oTrace.com/backup/` — espelho da config viva.
- `oTrace.com/backup/historico-*` — versões anteriores, preservadas (inclui a V14).
- O backup **nunca** contém segredos além do que já está no config (login/senha da IQ ficam no
  `bot-config-v15.json`, que é o arquivo vivo).

---

## 5. Relatório com as evidências

`diagnostic-results/bot-v15-relatorio.md` — o diagnóstico das vendas da R8, a investigação da
V10 (o que foi salvo e o que era bug) e as medições da V15 (testes + replay real).

---

---

## 6. Auditoria da lógica (2026-10-01, gauntlet) — o que foi corrigido SEM mudar regra

Revisão integral do código antes do primeiro run. Nenhuma decisão de negócio, config ou fluxo de
ordem/venda mudou — só defeitos reais e resíduo:

1. **Queda do WebSocket deixava o bot ZUMBI.** O cliente (`iqoption-ws.mjs`) emite `close`
   **só quando a conexão estava READY** (falha de boot não conta como fim de sessão) — mas o
   `ws.on('close')` do bot **só logava**, e a sessão ficava pendurada com feed morto, sem resumo.
   **CORRIGIDO de verdade em 2026-10-01 (auditoria):** queda em sessão chama `shutdown('WS')`
   → resumo final + exit. Não existe reconexão no cliente: queda = fim da sessão.
2. **O dump `IQ_SELL_DEBUG=1` era código morto**: a janela existia mas **nunca era aberta** (por
   isso a variável nunca imprimia nada). A janela agora abre no **pedido de venda** (10s) — é o
   que permite investigar a resposta da IQ a um `sell-options`.
3. **Erro no boot virava `UnhandledPromiseRejection`** (stack crua e confusa): o `ready` agora tem
   catch explícito → `[FATAL]` + saída limpa.
4. **Log do cliente WS** (erros de socket/handler) ia em `console.log` cru e podia **quebrar a
   linha do painel**; agora passa pelo `logLine`.
5. **Resíduo removido** (zero impacto em decisão): `skipLogRemove()` vazia, contadores write-only
   (`skips`, `closed5s`, `signals`), parâmetro `now` não usado em `evaluateEntry`, `shortUni`
   duplicando `shortName`, e os `if (LIVE)`/`if (row)` redundantes.

Testes após a auditoria: **51/51** offline (2 novos cobrem a queda de conexão no cliente) +
replay real com candles 5s (zero ordens).

## 7. README do operador

`README.bot.md` — manual completo do bot para o operador (não é dev). Contém:
como rodar, contas, filtros, martingale, venda antecipada, circuit breaker, painel,
todas as configurações com valores padrão, debugging e atalhos rápidos. Atualizado
em 2026-10-01 junto com o commit deste arquivo.

## 8. SCALP + AUDITORIA (2026-10-01) — HISTÓRICO (SUPERADO em 2026-10-02)

> **SUPERADO em 2026-10-02:** a regra de `takeProfit`/SCALP foi **removida** (config e código).
> O bot NUNCA vende ganhando e a venda antecipada agora só sai com **confirmação de reversão
> contra a posição** — ver §14. O texto abaixo fica como registro histórico da fase em que a
> cotação ainda era lida como lucro.

**Correção de entendimento (2026-10-01):** SCALP **não** é "qualquer lucro > 0".
É **mínimo 20% do stake** (R$0,40 com stake R$2). Config: `takeProfitPctOfStake = 20`.
`takeProfitPctOfStake = -1` é o modo anterior (qualquer positivo, desativado). O bot
vende quando `sell_profit >= 0.20 × 2.00 = R$0,40`. Alvo: tirar a perda quase toda
do caminho, fechando a posição no lucro aceitável ao invés de esperar 50% do win
ou o fim de 5 min.

Também nessa sessão:

- **ADX = 0 bloqueia entrada.** Antes a regra era `adx > 0 && adx < adxMin` — isso
  deixava passar ADX=0 (ativo sem histórico 1m suficiente), o que gerava entrada
  contra pullback aleatório. Agora `adx < adxMin` cobre os dois casos (fraco e zero).
- **Boot paralelizado.** `getCandlesHistory` roda em chunks de 10 — antes era
  sequencial (170 ativos × 2-4s = 3-4 min só pra hidratar), agora hidrata em segundos.
- **Mensagem de boot refletia o alvo (SUPERADO).** A linha `[✂️]` mostrava o alvo (R$0.40 com
  20% do stake) ou "MODO SCALP" — removido junto com o takeProfit; hoje ela descreve a
  confirmação de reversão.
- **Diagnóstico de poll vazio (SUPERADO em 2026-10-02 — o poll foi removido; a cotação agora
  vem do push `position-changed`, ver §13).** Se o `getOptions` retornava `open_options` vazio
  e o bot tinha ordens em voo, ele imprimia UMA linha `[💱] poll sem posições` (antes era
  silêncio total). A venda continuava DESLIGADA só quando a IQ parava de responder 5x seguidas.
- **Bug resgatado do nada.** `let quoteSampleLogged = false;` foi declarado em
  duplicidade ao aplicar o diagnóstico de poll vazio. Erro de syntax quebrou o
  boot. O segundo `let` foi removido.

Testes: **56/56** (2 novos — ADX=0 bloqueia, ADX fraco bloqueia).

## 9. EARLY GALE MONITOR (2026-10-01) — monitor a cada 1s

Monitor de 1 segundo que reavalia cada posição aberta. Se a posição está perdendo
acima do limiar (`lossThreshold`) dentro da janela (`minMs..maxMs`), chama
`maybeTrade()` para abrir o gale ANTES da operação original fechar em loss — o
martingale fica mais eficiente.

Config em `bot-config-v15.json` → `sell.earlyGale`:
- `enabled`: true/false
- `minMs`: 15000 (não avalia antes de 15s)
- `maxMs`: 90000 (janela máxima)
- `lossThreshold`: 0.80 (sell_profit <= -R$0,80 para ativar)

O monitor faz poll forçado se as cotações estão velhas (> 2× o intervalo do poll).
Loga `[👁️] EARLY GALE ativo` uma única vez na primeira detecção.

Correção do painel: `\x1b[2K` substituído por `\r` + espaços + `\r`
— abordagem mais portátil no Git Bash/Windows. `logLine` agora chama `console.log`
diretamente e depois `renderDashboard()` para manter o painel na linha inferior.

**ESTADO REAL (auditoria 2026-10-01): o monitor está INERTE — não abre nada.**
Dois defeitos encadeados: (a) o monitor busca `quotes.get(String(op.id))`, mas o objeto de
`inFlight` nunca tem `id` (tem `okey/orderId/requestId`) → `if (!q) continue` sempre;
(b) mesmo corrigindo isso, `planTrade` calcula `gale = !open.length && ...` — com a posição
ainda aberta o gale vira `false` e `evaluateEntry` cairia no ramo de **pyramidagem**, que não
conta no ciclo e não passa por ADX/pullback/regime. Zero testes cobrem o monitor.

**Decisão do dono (2026-10-01): deixar como está, documentado.** Para valer de verdade
precisa de desenho próprio (gale com posição aberta, contabilidade no ciclo, portões de
entrada e testes) — tratar como mudança estratégica, não como bugfix.

---

## 10. AUDITORIA + LIMPEZA (2026-10-01) — sem mudar regra

Auditoria completa do código vivo (relatório externo reconciliado linha a linha contra o
arquivo). Nenhuma decisão de negócio, config ou fluxo de ordem/venda mudou — só defeito real
e resíduo:

1. **Zumbi de WS corrigido de verdade.** O cliente emite `close` só quando a conexão estava
   READY, mas o `ws.on('close')` do bot **só logava** — queda em sessão deixava o painel
   girando com feed morto, sem resumo. Agora chama `shutdown('WS')` → resumo final + exit.
   (Não há reconexão no cliente: queda = fim da sessão.)
2. **Resíduo removido (zero impacto em decisão):** `FLIP_AFTER_LOSSES` hardcoded (flip
   desativado na V16; o campo `martingale.flipAfterLosses` do config também saiu), bloco
   `cooldown` do config (o código usa 0ms pós-win / 5000ms pós-loss hardcoded, entre ciclos),
   `stop.stopAfterLosses` (nunca lido), parâmetro `pyramidCount` (calculado e ignorado) e a
   linha `if (gale && sameDir.length) pyramidBlock` (inalcançável — gale só existe sem posição
   aberta). Logs de boot do universo e o `[🔍] diag 60s` saíram de `console.error` para
   `logLine` (stderr se misturava com o painel).
3. **Pendências de decisão anotadas — NÃO corrigir sem pedido explícito do dono:**
   - **gale × pullback:** o código exige o padrão fade4 (4+1) também no gale; §2 registra
     "sem exigir pullback novo". Decidir qual vale.
   - **regime × pullback:** comentário no código e §2 sugerem que pullback dentro de tendência
     deveria passar, mas `regime.state === 'trending'` bloqueia mesmo com pullback formado.
     Decidir qual vale.
4. **Cooldown real (não configurável):** 0ms após win / 5000ms após loss, só entre ciclos
   (ativo sem operação aberta).

Testes após a limpeza: **56/56** offline (nenhuma ordem).

---

## 11. HIDRATAÇÃO DO BOOT (2026-10-02 — bug corrigido)

**Bug:** o bot assinava o feed ao vivo **antes** de hidratar o histórico. Com o feed ativo, o
candle em formação "engole" o lote de histórico no `ClosedCandles.ingest` (as velas antigas
não disparam flush) — medido em diagnóstico com dados reais: **0/30 ativos prontos com o feed
assinado antes vs 30/30 com a hidratação primeiro**. Sintoma no boot: `[🔁] histórico: 9/92`
e o bot parecendo travado/sem dados (e sem ADX, pois o buffer ficava vazio).

**Correção:** no boot, `applyUniverse(..., { subscribe: false })` → hidrata → **só depois**
assina o feed. A linha do histórico agora mostra tempo e falhas:
`[🔁] histórico: 92/92 ativos com dados suficientes (5s≥20, 1m≥1) | 7.8s`.

- Diagnóstico read-only: `node diagnostic-results/bot-v15-hidratacao-diag.mjs`
  (login + get-candles, zero ordens; mede chunks/tempo/eco do request_id).
- Regressão offline na suíte (hoje **70/70**): seção 3.1 "HIDRATAÇÃO (a ordem importa)".
- **Ordem crítica: nunca assinar candles antes de hidratar.**

---

## 12. ADX DO FEED (2026-10-02 — o "0 ops" corrigido)

**Bug:** o ADX calculava DMI com `high ?? close` / `low ?? close`, mas as barras internas eram
`{ atMs, close }` (sem high/low) → DMI = 0 → **ADX = 0 em todo ativo** → o portão `adxFraco`
bloqueava TODA entrada. Sintoma: sessão inteira sem operar; no replay, 15.669 bloqueios
`adxFraco`.

**Correção:** o feed já mandava `max`/`min`; agora o bot mapeia `highOf(raw)` (`high,max,price_high,h`)
e `lowOf(raw)` (`low,min,price_low,l`), e o `ClosedCandles` acumula `formingHigh/formingLow`
(`Math.max/min`) gravando `{ atMs, close, high, low }`. O portão `adxFraco` não mudou.

**Evidência:** boot com `adxSample=18.8` (antes 0), entradas reais com ADX 20–36 e W/L em demo;
regressão na suíte (seção 3.2): com high/low o ADX > 0, só com close = 0.

## 13. COTAÇÃO EM TEMPO REAL — PUSH `position-changed` (2026-10-02 — venda por cotação ativada)

**Bug:** a venda por cotação **nunca disparava**. O `get-options` v2.0 é silencioso na IQ (não
responde); a v1.0 responde (`options`, sem `request_id`) mas as linhas de `open_options` **não
têm `sell_profit`** — o campo `profit` fica sempre 0.

**Correção:** a cotação agora vem do push do broker **`portfolio.position-changed` v3.0**
(`subscribePositionChanges` no boot; instrumentos `turbo-option` e `binary-option`), que traz
`sell_profit` real a cada mudança da posição. `parsePositionChanged` lê `sell_profit` estrito e o
id da opção em `external_id`; `QUOTE_FRESH_MS=3000` = validade da cotação (sem cotação fresca =
não vende — fail-closed). **O poll foi removido** (o cliente WS mantém `getOptions` v1.0 com
teste de regressão, mas o bot não usa poll). `IQ_SELL_DEBUG=1` dumpa os primeiros eventos crus e
os 10s em volta de cada venda.

**Evidência ao vivo (demo, 2026-10-02):**
- evento real: `{"id":14315713333,"status":"open","sell_profit":0.7644,"expected_profit":2,...}`;
- vendas antecipadas executadas ~0,6s após abrir, aceitas pela IQ (`sold-options` /
  `socket-option-closed`) e batidas contra o saldo; sessão flat.
- sonda read-only que comprovou a semântica (líquido = devolução − stake):
  `node diagnostic-results/_probe-closed.mjs` (dumpa `closed_options`; não abre/vende nada).

**Bugs menores corrigidos junto:** o log da venda lia `decision.recovery` fora do ramo de corte
→ `HANDLER_ERROR position-changed ... reading 'toFixed'` a cada venda (o sell saía, o log
quebrava); e o rótulo final chamava venda no lucro de "corte no fim". Ambos com regressão na
suíte.

**Estado de produção (2026-10-02, fim do dia):** `takeProfit`/SCALP **removidos** — a venda
antecipada só sai com **confirmação de reversão contra a posição** (§14), **a mercado** (não há
cotação de meio de vida), e depois dela o bot **entra no sentido novo** (gale de reversão).
`minRecover`/`quoteFreshMs` foram removidos do config.

---

## 14. VENDA POR REVERSÃO CONFIRMADA + GALE DE REVERSÃO (2026-10-02 — regra do dono)

**Regra:** vender antes SÓ quando houver **confirmação de reversão contra a operação** — ou
seja, grande chance de dar loss. Pedido do dono depois de ver o bot segurar posições que o
mercado virou de vez (prints Polkadot/Fartcoin de 2026-10-02, 07:25).

**A venda é A MERCADO.** Medido ao vivo em 2026-10-02: a IQ manda `sell_profit` (a DEVOLUÇÃO
da recompra) **só no abrir e no fechar** de cada posição — o push `position-changed` chega 1×
por opção, na abertura (contador por opção), e o `get-options` em voo é **estático**
(`profit: 0`, nada muda ao longo da opção). Logo não existe cotação de meio de vida: o bot
decide pela reversão e o valor real da recompra é lido **no fechamento** (`finalizeEarly`).

**Confirmação (`reversalAgainst`, todos os fatores precisam concordar):**
1. **tendência virou contra** — `trendDirection` (EMA8×21) aponta o lado oposto da posição;
2. **RSI do lado oposto** — CALL: RSI ≤ `rsiCallMax` (45); PUT: RSI ≥ `rsiPutMin` (55);
3. **velas contra** — ≥ `candlesAgainstMin` (2) das últimas `candles` (3) velas de 5s fecham
   contra a posição;
4. **movimento adverso** — preço contra a entrada ≥ `minAdverseFactor` (1) × o candle típico
   de 5s (piso `minAdversePct` 0,02%). É esse fator que impede vender operação ganhando.

**Janela:** restantes > `closeBeforeMs` (20s) — a IQ não aceita buyback em cima do vencimento.
A avaliação roda **a cada 1 segundo** por posição aberta (`setInterval` no boot).

**Vender cedo é o que salva** (medido ao vivo): a recompra vale ~R$0,75–1,00 nos primeiros
minutos (perda de ~1,00–1,25 em vez de 2,00) e ~R$0,15 no último minuto (o print Polkadot com
1:11 restantes mostrava L/P pós-venda −98%, ou seja, venda no fim não salva nada).

**GALE DE REVERSÃO (`sell.reversalGale`, padrão true):** ao fechar por reversão, o bot arma a
entrada no **sentido NOVO** (o lado da reversão) pela janela do gale (`trading.galeWindowMs`,
120s) e essa entrada **não exige pullback novo** — o flip é o gatilho. Se o lado antigo ainda
tiver posições abertas, a guarda `ladoOposto` faz o bot esperar; o gatilho é consumido na
ordem (`maybeTrade`).

**PIRAMIDAGEM (corrigida junto, mesma sessão):** o ramo de pyramid só olhava EMA + RSI — foi
o que empilhou 3 CALLs no Polkadot (ADX caiu 23.0 → 20.7 → **16.1**, abaixo do mínimo 20).
Agora a piramidagem exige **ADX ≥ `adxMin`** e **para quando a reversão está se formando**
contra a posição aberta (mesmos fatores de preço/velas/RSI, com `requireTrendFlip: false`).

**Correção medida ao vivo (build `2fae4889`):** na 1ª execução real o gatilho **armava e não
entrava** — o ramo do gale estava **depois** dos portões da entrada normal (pullback/regime/ADX)
e, logo após o flip, a EMA volta a ficar lateral e o ADX cai, então `lateral`/`semPullback`/
`adxFraco` barravam dentro da janela de 120s. Provado no log `revgale.log` (build antigo
`fb70a87b`): estado com `reversalGale:{"direction":"PUT"}` armado em SUIUSD e TRUMPUSD e
**nenhuma** ordem `(GALE REVERSÃO)`. Agora o ramo do gale vem **antes** dos portões (só exige
`trend.direction` no sentido armado); as travas globais (`ladoOposto`, exposição, saldo, trava
de sessão) continuam em `evaluateGuards`.

**Vendas por reversão medidas ao vivo (demo):** SATSUSD devolveu 0,87 de 2,00 (restam 197s) ·
WIFUSD 0,49 (145s) · WLDUSD 0,73 (72s) · SUIUSD 0,67 e 0,45 (264s) · TRUMPUSD 0,76 e 0,84
(195s/154s), todas `profitSource: close_sell_return` / `result: early`. Ou seja: a venda corta
~25–45% do stake em vez de perder 100%. No Polkadot do print (5 CALLs, US$8,00) faltando 1:11 a
recompra valia ~US$0,15 (L/P pós-venda −98%) — **vender no fim não salva; a janela é quando a
reversão confirma** (poucos segundos depois de cruzar a entrada).

**Evidência:** suíte **70/70** (seções 6 e 9: confirmação CALL/PUT espelhada, sem reversão =
espera, uma vela contra ≠ reversão, preço a favor = espera, piramidagem barrada por ADX baixo e
por reversão formando, gale de reversão entra sem pullback e **ignora os portões da entrada
normal**) + E2E demo nos logs `diagnostic-results/bot-e2e-2026-10-02-revgale.log` (venda por
reversão + gatilho armado no build antigo) e `-revgale2.log` (build corrigido).

**Cadeia completa medida ao vivo no build corrigido (DYDXUSD, `-revgale2.log`):**
`PUT` base + `PUT` pyramid (ADX 32,4/31,5) → reversão confirmada → vende as duas (devolveu
0,52 e 0,79) → **`[📤 ORDEM] DYDXUSD CALL (GALE REVERSÃO)`** → virou de novo → vende
(devolveu 0,07) → **`[📤 ORDEM] DYDXUSD PUT (GALE REVERSÃO)`** → **WIN +1,74**. As travas da
piramidagem também apareceram no run (ADX mínimo 20 e nenhum reforço contra reversão formando).

**Limites honestos da regra (medidos):** (a) a venda devolve 25–45% do stake quando a reversão
confirma cedo (111s de vida) e **~3,5%** quando confirma tarde (175s) — quem manda é o momento em
que o preço cruza a entrada, não o relógio; (b) em mercado de serra a cadeia pode emendar perdas
(ex.: as 3 vendas acima somaram −4,62 antes do win de +1,74); (c) o gale de reversão **não olha
ADX** (o gatilho é o flip) — medido 1× com ADX 8,6 (lateral).

**Limite conhecido (não é regressão):** se o WebSocket cair, o bot encerra com o resumo final e
**não reconecta** por projeto (`[WS] Conexão encerrada — encerrando o bot (sem reconexão)`) —
observado 1× ao vivo (run `revgale.log`, 12min de vida). Para operar 24/7 é preciso supervisão
ou uma reconexão com rearranjo seguro (ainda não existe).

---

## 15. CICLO DE 3 ORDENS: ENTRADA + PIRÂMIDE EXTREMA + MARTINGALE 2,75× (2026-10-02 — regra do dono)

**O que o dono decidiu:** (a) no máximo **2 posições simultâneas** no mesmo sentido — a 2ª só com
chance quase perfeita de não reverter, senão **1 compra só**; (b) a **3ª ordem do ciclo é o
martingale**, a única que pode operar acima do stake fixo; (c) martingale = **2,75 × o que está
sendo recuperado** (2 posições de 2,00 → 4,00 → **US$11,00**); (d) **um martingale por
sequência** — se ele perder, a próxima ordem volta ao stake base (nunca emenda, nunca compõe);
(e) expiração de **2 minutos** (como o V13 que subiu a demo de 60 para 145).

**A pirâmide (2ª compra) exige os três fatores juntos:** `ADX ≥ pyramidAdxMin` (25) + RSI no
extremo A FAVOR (CALL ≤ `pyramidRsiCallMax` 35 / PUT ≥ `pyramidRsiPutMin` 65) + a reversão não
pode estar se formando contra a posição. `pyramidMax = 1` → **no máximo 2 posições
simultâneas**; a 3ª ordem do ciclo é o martingale.

**Martingale:** arma na venda por reversão (acumulando o stake de cada ordem da sequência que
fechar por reversão — `stakeBase`), entra no sentido NOVO dentro da janela do gale e é
**consumido** ao ser enviado. Duas guardas impedem a escada composta:

1. **o martingale não arma outro martingale** (`op.kind !== 'reversalGale'` na armação) — só
   posição de stake base arma, então o valor nunca passa de `2,75 × (base × posições)`;
2. **fechar o martingale zera o ciclo** (`applyResult`: `op.kind === 'reversalGale'` →
   `cycleOps = 0`, `galeArmedAt = 0`) — a próxima ordem do ativo volta à base.

**Evidência do furo (e da correção):** no primeiro run ao vivo (build `f502f426`) o martingale de
5,50 foi vendido por reversão e armou **15,13** (`2,75 × 5,50`), depois **41,59** — a mesma
escada que o V13 antigo levou a US$1,4 trilhão por ordem em 10-01. Com a guarda, o ciclo fecha.
Suíte: **70/70** (seção 12: `martingaleStake(4) === 11`, recuperação com lucro no payout 82%,
2 minutos, teto por ordem que caiba o martingale, martingale não arma martingale).

**Evidência ao vivo do martingale (build `f502f426`, demo):** `SHIBUSD PUT US$2.00` → reversão
confirmada → venda por reversão (devolveu 0,22, líquido −1,78) → **`SHIBUSD CALL US$5.50
(MARTINGALE 2.75x)`** entrou no sentido novo (`martingale — reversão confirmada: tendência alta
0,34% | RSI 74 | ADX 29,6`).

**Primeira sequência completa no build corrigido (`bf1d085f`, demo), e o que ela ensina:**
`ONDOUSD PUT 2,00` → venda por reversão (devolveu 0,15, líquido −1,85) → `ONDOUSD CALL 5,50
(MARTINGALE 2.75x)` → vendido por reversão outra vez (devolveu 0,21, líquido −5,29) → sequência
fechada em **−7,14**, ciclo zerado (o martingale **não** rearmou — a guarda funcionou).
**Com 2 minutos a venda por reversão chega tarde demais:** o valor da recompra foi 7,5% e 3,8% do
stake (com 5 minutos a mesma regra devolvia 22–45%). A reversão confirmada demora mais do que a
opção de 2 min perde valor — quem escolher 2 min precisa saber que a venda deixa de ser um alívio
e a recuperação fica inteira nas mãos do martingale dar certo na primeira tentativa.

**O que o V13 de 30/09 fazia e isso aqui NÃO repete (forense em §16):** a escada composta
`2 × 2,75^(losses−1)` (2 → 5,50 → 15,13 → 41,59 → 114,38 → 314,55...) e o contador de losses que
nunca resetava quando a IQ recusava a ordem — o estado arquivado de 10-01 mostra stakes de
US$444.990.949 (20 losses) e US$1.455.501.740.410 (28 losses), com o saldo demo de 60 → 0,38.

---

## 16. FORENSE DO RUN QUE SUBIU 60 → 145 (2026-09-30, ~20:28)

**Correção de memória:** não era o V10 (V10 é de 30/09 de manhã: 15 ops, WR 46,7%, **−4,52**).
O run que subiu a conta demo era o **V13 "learning"** — arquivos de 30/09 (`ws-otc-v13.mjs`
do cofre 21:32 = `ws-otc-v13-backup-original.mjs`, hash `4326c4cd`; `bot-config-v13.json`
21:21; `bot-state-v13.json` + `learning-state.json` 19:54).

**Ressalva:** cada versão grava `resultados-vXX.json` só com as ops da execução corrente (o bot
não lê o arquivo no boot) — a sessão de 30/09 noite foi **sobrescrita** pelas execuções
seguintes. O que sobrou: o instantâneo de estado das 19:49, o `learning-state.json`, o config, o
código e o estado arquivado de 10-01.

**O que aquele bot fazia (as 10 coisas):** (1) whitelist fixa de 10 ativos com **direção fixa** e
WR histórico (RENDERUSD CALL 100%, WIFUSD/DOTUSD/SUIUSD/XPTUSD PUT 100%, ORDIUSD/HYPE CALL 75%,
TRON CALL 66,7%, SHIBUSD PUT 66,7%, RAYDIUMUSD CALL 66,7%); (2) entrada de **reversão à média**
(`fade4`: 4 velas de 5s na mesma direção → entra na direção da whitelist) — o oposto do V16, que
é seguidor de tendência; (3) só opera em regime **`ranging`**; (4) RSI 35/65 como guarda;
(5) **opções de 2 minutos**; (6) uma ordem em voo por ativo e só candle fechado; (7) learning por
ativo (WR rolante, kill se WR < 45% após 10 ops, gate de Wilson 0,50); (8) **auto-flip após 2
losses** (volta no win); (9) **martingale 2,75×**; (10) venda antecipada configurada
(minProfitToSell 0,15 / 50% do máximo, 20–100s antes).

**Os números:** com payout 82% (medido no V16: 2,00 → +1,64), o martingale de **5,50** num win
devolve 4,51 e cobre a perda de 2,00 com **+2,51** — é por isso que a conta subiu. E é o mesmo
mecanismo que zerou depois: **o 2,75 deu o lucro e o 2,75 composto zerou a conta.**

**Contraste medido no V16 atual (mesmo dia):** run `revgale2.log` (build `2fae4889`) fechou com
**23 ops, 7 W / 16 L, WR 30,4%, −US$14,16** (17 vendas por reversão, 7 martingales). O V16 é
seguidor de tendência em 62 ativos; o V13 era reversão à média em 10 ativos com lado fixo +
martingale — filosofias opostas, e nesse demo a memória do dono está certa sobre qual somava.
