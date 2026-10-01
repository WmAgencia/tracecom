# MEMÓRIA DO BOT V15 (`ws-otc-v15.mjs`) — LEIA ISTO ANTES DE MEXER

> **Este arquivo é a memória do bot standalone do dono do projeto.** Toda sessão/agente que
> for alterar `ws-otc-v15.mjs`, `bot-config-v15.json` ou `iqoption-ws.mjs` lê isto **antes**.
> O que está escrito aqui foi decidido pelo dono e **não volta atrás sem pedido explícito dele**.
>
> A V14 (`ws-otc-v14.mjs`) continua no repositório **apenas como histórico** — a versão viva
> é a V15. Este bot é **separado** do motor oficial (`relay/`, estratégia V3 congelada em
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
- Testes: `node diagnostic-results/bot-v15-tests.mjs` (offline, nenhuma ordem — hoje 51/51).
  Replay com candles reais: `REAL=1 node diagnostic-results/bot-v15-tests.mjs` (login +
  get-candles, **zero ordens**).
- `IQ_WS_VERBOSE=1` liga o log detalhado do socket; `IQ_SELL_DEBUG=1` liga o dump cru da IQ
  nas janelas de venda (sem isso, silêncio total — o painel é a única saída viva).

---

## 2. As decisões do dono (o que ele quer)

| Assunto | Decisão | Onde |
|---|---|---|
| **Ativos operando** | **Sem limite.** No mínimo **10 ativos operando** (`universe.minActive`): top 10 primeiro; fechado/suspenso/sem feed → entra a reserva; reserva esgotada → qualquer OTC turbo disponível. Expande até 16 (`maxActive`). Revisão a cada 5 min; ativo sem candle 5s por 3 min é substituído. | `universe`, `reserve` |
| **Ordens por ativo** | **Ciclo do gale: até 3** (1 entrada + no máximo 2 gales), **uma ordem por vez**, sempre no mesmo sentido. Nunca CALL e PUT juntos. | `trading.maxOpsPerAsset` |
| **Gatilho do gale** | **Depois de um loss** (o corte no fim conta como loss) o bot volta no **mesmo ativo** em até `galeWindowMs`, **sem exigir pullback novo**. Direção = tendência do momento. | `trading.galeWindowMs` |
| **Valor** | **Sempre 2** (US$2 na demo / R$2 na real). A escalada de valor fica desligada (`martingale.levels: 0`). | `trading.baseStake` |
| **Direção** | **Tendência do mercado** (EMA8 × EMA21, spread ≥ 0,05%). Alta compra CALL no pullback; baixa vende PUT no repique; lateral não entra. | `strategy.trendMinEmaSpreadPct` |
| **VENDA** | **SÓ POR COTAÇÃO REAL (`sell_profit`, que é LÍQUIDO).** Positiva: realiza a partir de **50% do win** (≈ +0,86 com stake 2/86%). Perdendo: **só no fim** (entre 20s e 40s restantes) e **somente** se (a) a venda devolver **≥ 0,50** e (b) o preço estiver **LONGE da linha** — distância ≥ **4× o candle típico de 5s** (piso 0,05%). **Perto da linha o bot ESPERA.** Sem cotação fresca = **não vende**. **NUNCA vende por reversão.** | `sell`, `sellDecision()` |
| **Teto de exposição** | **Fração do saldo** (50%), nunca número absoluto. | `risk.maxExposurePct` |
| **Circuit breaker** | **3 losses seguidos → 5 min** sem abrir ordem nova (era 20 min; 20 min de silêncio dava a impressão de "não está operando"). O painel mostra o tempo restante. | `risk.stopAfterConsecutiveLosses`, `pauseAfterLossStreakMs` |
| **Trava de perda da sessão** | Perdeu **20% do saldo inicial** → para de abrir até reiniciar. | `risk.maxSessionLossPct` |
| **Painel** | Uma linha só, estilo **odômetro**: candles fechados, ops, W, L, vendas, WR, P/L, abertas, ativos rodando, pausa, relógio. Sem lista por ativo. | `dashboardText()` |
| **Warmup** | 5s (o histórico do boot já traz ~120 candles de 5s + 30 de 1m por ativo). | `strategy.warmupMs` |
| **RSI** | **Guarda-corpo**: não compra com RSI > 60, não vende com RSI < 40. | `strategy.rsiCallMax/rsiPutMin` |
| **Regime** | Bloqueia entrada com 10+ candles iguais seguidos. | `strategy.regimeStreakThreshold` |

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
