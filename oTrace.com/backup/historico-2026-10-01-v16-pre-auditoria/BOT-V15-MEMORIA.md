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
  `[🧬] CÓDIGO V15 sha256:xxxxxxxx` — se a tela mostrar outro hash, é código velho rodando.
- Testes: `node diagnostic-results/bot-v15-tests.mjs` (offline, nenhuma ordem — hoje 53/53).
  Replay com candles reais: `REAL=1 node diagnostic-results/bot-v15-tests.mjs` (login +
  get-candles, **zero ordens**).
- `IQ_WS_VERBOSE=1` liga o log detalhado do socket; `IQ_SELL_DEBUG=1` liga o dump cru da IQ
  nas janelas de venda (sem isso, silêncio total — o painel é a única saída viva).

---

## 2. As decisões do dono (o que ele quer)

| Assunto | Decisão | Onde |
|---|---|---|
| **Ativos operando** | **Sem limite expandido para 170+.** No mínimo **170 ativos operando** (`universe.minActive=170`, `maxActive=200`). Top 61 na whitelist + 26 na reserva; auto-fill completa com qualquer OTC turbo disponível. Revisão a cada 30s; ativo sem candle 5s por 3 min é substituído. | `universe`, `whitelist`, `reserve` |
| **Ordens por ativo** | **Piramidagem: até 3** no mesmo sentido (mesma tendência forte — EMA8×21 confirma). Regra: `sameDir.length < maxOpsPerAsset` E RSI não esticado (CALL: RSI < 55, PUT: RSI > 45). Ciclo do gale (1 entrada + até 2 gales) é independente — gale entra depois de loss, pyramid entra junto com a tendência. Nunca CALL e PUT juntos. Ciclo reseta após win ou expiração da janela de gale. | `evaluateEntry`, `trading.maxOpsPerAsset` |
| **Gatilho do gale** | **Depois de um loss** (o corte no fim conta como loss) o bot volta no **mesmo ativo** em até `galeWindowMs`, **sem exigir pullback novo**. Direção = tendência do momento. | `trading.galeWindowMs` |
| **Valor** | **Sempre 2** (US$2 na demo / R$2 na real). A escalada de valor fica desligada (`martingale.levels: 0`). | `trading.baseStake` |
| **Direção** | **Tendência do mercado** (EMA8 × EMA21, spread ≥ 0,06%). Alta compra CALL no pullback; baixa vende PUT no repique; lateral não entra. | `strategy.trendMinEmaSpreadPct` |
| **RSI** | **Guarda-corpo mais apertado V16:** não compra com RSI > 55, não vende com RSI < 45 (era 60/40). | `strategy.rsiCallMax/rsiPutMin` |
| **ADX** | **NOVO V16:** ADX mínimo 20 — a tendência precisa ter força mínima para operar (não é só direção). ADX < 20 = mercado fraco/lateral, entrada proibida. **ADX = 0** (ativo sem histórico 1m suficiente) também bloqueia — não é "tendência fraca", é falta de dados. | `strategy.adxMin` |
| **Regime** | Bloqueia entrada com 12+ candles iguais seguidos. Pullback DENTRO da tendência é válido (check de pullback agora ANTES do regime). | `strategy.regimeStreakThreshold` |
| **VENDA** | **SÓ POR COTAÇÃO REAL (`sell_profit`, que é LÍQUIDO).** Positiva: realiza quando `sell_profit >= takeProfitPctOfStake` do stake (20% = R$0,40 com stake 2) — `takeProfitPctOfStake` tem prioridade sobre `takeProfitPctOfWin`. **MODO SCALP:** `takeProfitPctOfStake = -1` vende qualquer `sell_profit > 0` no primeiro momento. Perdendo: **só no fim** (entre 20s e 40s restantes) e **somente** se (a) a venda devolver **≥ R$0,50** e (b) o preço estiver **LONGE da linha** — distância ≥ **4× o candle típico de 5s** (piso 0,05%). **Perto da linha o bot ESPERA.** Sem cotação fresca = **não vende**. **NUNCA vende por reversão.** | `sell`, `sellDecision()` |
| **Teto de exposição** | **Fração do saldo** (50%), nunca número absoluto. | `risk.maxExposurePct` |
| **Circuit breaker** | **REMOVIDO em V16.** O bot opera continuamente sem pausa por losses consecutivos. A única proteção contra perdas é a **trava de perda da sessão (20%)**. | `risk` (removido) |
| **Trava de perda da sessão** | Perdeu **20% do saldo inicial** (saldo no boot desta sessão) → para de abrir até reiniciar. As perdas de **sessões anteriores** não são carregadas — `sessionStartBalance` é definido no boot com o saldo atual, e `sessionLoss` começa em 0 a cada nova sessão. | `sessionStartBalance`, `sessionLoss` |
| **Painel** | Uma linha só, estilo **odômetro**: candles fechados, ops, W, L, vendas, WR, P/L, abertas, ativos rodando, pausa, relógio. Sem lista por ativo. | `dashboardText()` |
| **Warmup** | 5s (o histórico do boot já traz ~120 candles de 5s + 30 de 1m por ativo). **Boot paralelizado em chunks de 10 ativos** (`getCandlesHistory` em paralelo) — antes era sequencial e levava 3-4 minutos com 170 ativos; agora termina em segundos. | `strategy.warmupMs` |

---

## 3. Armadilhas já pagas (o dono perdeu dinheiro com isso — não repetir)

1. **`close-position` é ignorada em silêncio pela IQ.** A mensagem correta de venda antecipada é
   **`sell-options`** com `body: { options_ids: [id] }`. Há teste estático garantindo.
2. **Venda por REVERSÃO está proibida (v15).** Ela vendia **qualquer** op perdendo depois de 2
   candles contra, sem olhar valor/tempo/distância — foi o que o dono viu ("vendeu uma operação
   negativa"). Quem decide a venda agora é a **cotação real**.
3. **`sell-equal` nunca chegou em nenhuma sessão registrada.** O fechamento por venda chega em
   **`socket-option-closed`** (a posição fecha ~10-45s depois do pedido). O handler de
   `sell-equal` existe só como reconciliação — o caminho principal é o closed antecipado.
4. **`sell_profit` é LÍQUIDO** (resultado se vender agora; pode ser negativo). O handler antigo
   fazia `recebido - stake` — com −1,66 gravaria −3,66. A V15 usa o líquido direto.
5. **As vendas da R8 foram gravadas como −2 cheio** (4 posições fechadas 10s/20s/45s após abrir,
   `earlySell: false`) porque o bot nunca leu a cotação. A V15 lê ANTES de vender e grava o
   valor real; o resumo separa W/L pelo sinal.
6. **A V10 empilhava ordens no mesmo segundo no mesmo ativo** (ex.: 3 HYPE em 0,5s) — parte do
   "muitas operações simultâneas" dela era bug (68 ordens em 11,5 min, só 15 fechadas, −3,80 no
   relatório). **Não reintroduzir empilhamento.**
7. **Sem cotação reconhecida = venda automática desligada** (fail-closed). O bot só vende com
   `sell_profit` fresco (lista `open_options` do `get-options`). A primeira cotação imprime UMA
   linha `[💱]` com os campos recebidos, para conferir o mapeamento.
8. **Ordem sem ACK da IQ em 5s** agora avisa no log (ordem pode não ter chegado ao broker).
9. **`get-candles`: `to` é em SEGUNDOS** e a paginação não funciona (sempre vem 1000 candles).
10. **Um único ponto abre ordem** e **um único ponto pede venda** — testes estáticos garantem.

---

## 4. Backup (o cofre)

Toda alteração aprovada exige copiar os arquivos vivos para o cofre:

```bash
cp ws-otc-v15.mjs bot-config-v15.json BOT-V15-MEMORIA.md iqoption-ws.mjs oTrace.com/backup/
cp diagnostic-results/bot-v15-tests.mjs diagnostic-results/bot-v15-relatorio.md oTrace.com/backup/
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

1. **Queda do WebSocket deixava o bot ZUMBI.** O cliente (`iqoption-ws.mjs`) nunca avisava o bot
   quando o socket caía — o `ws.on('close')` do bot era **código morto** e a sessão ficava
   pendurada sem resumo nenhum. Agora o cliente emite `close` **só quando a conexão estava READY**
   (falha de uma tentativa do boot não conta como fim de sessão) e o bot **sempre** imprime o
   resumo final e sai.
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

## 8. SCALP + AUDITORIA (2026-10-01) — alvo 20% do stake

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
- **Mensagem de boot reflete o alvo.** A linha `[✂️] VENDA só por cotação real: ...`
  mostra o alvo correto (R$0.40 com 20% do stake) quando `takeProfitPctOfStake = 20`,
  ou "MODO SCALP: qualquer lucro > 0" quando `takeProfitPctOfStake = -1`.
- **Diagnóstico de poll vazio.** Se o `getOptions` retornar `open_options` vazio
  e o bot tiver ordens em voo, ele imprime UMA linha `[💱] poll sem posições`
  (antes era silêncio total). A venda continua DESLIGADA só quando a IQ para de
  responder 5x seguidas (já existia).
- **Bug resgatado do nada.** `let quoteSampleLogged = false;` foi declarado em
  duplicidade ao aplicar o diagnóstico de poll vazio. Erro de syntax quebrou o
  boot. O segundo `let` foi removido.

Testes: **56/56** (2 novos — ADX=0 bloqueia, ADX fraco bloquei).

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
