# MEMÓRIA DO BOT V14 (`ws-otc-v14.mjs`) — LEIA ISTO ANTES DE MEXER

> **Este arquivo é a memória do bot standalone do dono do projeto.** Toda sessão/agente que
> for alterar `ws-otc-v14.mjs`, `bot-config-v14.json` ou `iqoption-ws.mjs` lê isto **antes**.
> O que está escrito aqui foi decidido pelo dono e **não volta atrás sem pedido explícito dele**.
>
> Este bot é **separado** do motor oficial (`relay/`, estratégia V3 congelada em `AGENTS.md`).
> As regras de lá (ex.: martingale proibido no V2/V3) **não** se aplicam a este script, e
> nada daqui pode ser copiado para o motor oficial.

---

## 1. Como rodar

```bash
cd "D:/Tracecom project"
node ws-otc-v14.mjs demo      # conta PRACTICE (id 1250741747, USD)
node ws-otc-v14.mjs real      # conta REAL (id 1250741746, BRL)
node ws-otc-v14.mjs           # pergunta: 1 = REAL | 2 = DEMO
```

- **O bot não recarrega sozinho.** Depois de qualquer alteração, **reiniciar**. Se a tela do
  broker mostrar stake/limite diferente do arquivo, é código velho rodando.
- O boot imprime `[🧬 CÓDIGO] R<n> sha256:xxxxxxxx`. Cada ordem gravada em
  `resultados-v14.json` leva o campo `rev` — é assim que se sabe qual revisão abriu a ordem.
- Testes: `node diagnostic-results/bot-v14-tests.mjs` (offline, nenhuma ordem).
  Replay com candles reais: `REAL=1 node diagnostic-results/bot-v14-tests.mjs` (login +
  get-candles, **zero ordens**).
- `IQ_WS_VERBOSE=1` liga o log detalhado do socket (senão é 1 linha por minuto).

---

## 2. As decisões do dono (o que ele quer)

| Assunto | Decisão | Onde |
|---|---|---|
| **Ativos simultâneos** | **Sem limite.** Todos os 10 ativos operam ao mesmo tempo, cada um achando a sua oportunidade. Não existe `maxConcurrentOps`. | `ws-otc-v14.mjs` (não reintroduzir) |
| **Ordens por ativo** | **Ciclo do gale: até 3** (1 entrada + no máximo 2 gales), **uma ordem por vez**, sempre no mesmo sentido. É o teto dos gales, não uma obrigação de operar 3x. | `trading.maxOpsPerAsset: 3` |
| **Gatilho do gale** | **Depois de um loss** (o corte na reversão também conta como loss) o bot volta no **mesmo ativo** em até `galeWindowMs`, **sem exigir pullback novo**. Direção = a tendência **daquele momento**. **Não existe reforço na continuação.** | `trading.galeWindowMs` |
| **Valor** | **Sempre 2** (US$2 na demo / R$2 na real). Nunca 4,33 / 9,36 — a escalada de valor fica **desligada** (`martingale.levels: 0`). | `trading.baseStake: 2` |
| **Direção** | Vem da **tendência do mercado** (EMA8 × EMA21, spread ≥ 0,05%). Alta compra CALL no pullback; baixa vende PUT no repique; **lateral não entra**. Nunca direção fixa por ativo. | `strategy.trendMinEmaSpreadPct` |
| **Nunca CALL e PUT no mesmo ativo** | Trava dura, primeira checagem de `evaluateGuards()` (`ladoOposto`). Segurar os dois lados é prejuízo estrutural. | `evaluateGuards()` |
| **Venda na reversão** | Preço anda **2 candles fechados contra** a ordem → **manda vender na hora** (`sell-options`). Não vende ordem no lucro (deixa vencer) nem nos últimos 20s. | `sellReversed()` |
| **Teto de exposição** | **Fração do saldo** (50%), nunca número absoluto. Encolhe junto com a conta. É a última linha de defesa, não um freio do dia a dia. | `risk.maxExposurePct: 50` |
| **Circuit breaker** | **3 losses seguidos** → 20 minutos sem abrir ordem nova. | `risk.stopAfterConsecutiveLosses` |
| **Trava de perda da sessão** | Perdeu **20% do saldo inicial** → para de abrir até reiniciar. | `risk.maxSessionLossPct: 20` |
| **Warmup** | 5s (o histórico do boot já traz ~119 candles de 5s + 29 de 1m). | `strategy.warmupMs: 5000` |
| **RSI** | **Guarda-corpo**, não seletor: não compra com RSI > 60, não vende com RSI < 40. Em 35/65 o bot praticamente não disparava (1 sinal em 9360). | `strategy.rsiCallMax/rsiPutMin` |
| **Regime** | Bloqueia entrada com 10+ candles iguais seguidos na mesma direção. | `strategy.regimeStreakThreshold` |

---

## 3. Armadilhas já pagas (o dono perdeu dinheiro com isso — não repetir)

1. **`close-position` é ignorada em silêncio pela IQ.** A mensagem correta de venda antecipada é
   **`sell-options`** com `body: { options_ids: [id] }` (é o que fazem os clientes de referência:
   `github.com/iqoptionapi/iqoptionapi` e a lib JS `LuKks/iqoption`). Com `close-position` a ordem
   seguia até o vencimento e fechava como **loss**, sem nenhum erro no socket.
   Há teste estático falhando se `close-position` voltar ao código.
2. **Venda com duplo gatilho não vende.** Existia um "early sell" separado que exigia 3 candles
   contra + movimento ≥ 1,5× a média + janela de tempo. Resultado: o bot logava a reversão e
   **não vendia** (ou vendia 30-60s tarde, com o preço já perdido). Agora é **um gatilho só**.
3. **Lado oposto aberto = prejuízo estrutural.** Um "flip" que abria o lado novo sem fechar o
   antigo produziu telas com 3 CALLs de $6 + 1 PUT de $2 no mesmo ativo. Com payout de 86%, existe
   faixa em que os dois lados perdem. O flip foi **removido** (teste estático garante).
4. **Empilhar no mesmo ativo é concentração.** O teto antigo de 3 ordens + exposição absoluta de
   US$40 permitia **65% do saldo** na mesa numa conta de US$60.
5. **Escalada de valor (2 → 4,33 → 9,36) não volta.** O dono pediu stake fixo em 2 — e isso vale também para os gales: o ciclo do gale existe, a escalada de valor não.
6. **Reforçar na continuação empilhava ordem no mesmo ativo** (3 CALLs de $6 na mesma tela) e não recuperava nada: a ordem anterior estava viva e o preço andando. O gale agora só entra **depois** que a anterior fechou, e só **depois de um loss**.
7. **`get-candles`: `to` é em SEGUNDOS** e a paginação não funciona (sempre vem 1000 candles).
   O buffer de 1m só serve como portão mínimo, nunca entra no sinal.
8. **Um único ponto abre ordem.** Só existe um lugar no arquivo que manda
   `binary-options.open-option`, e ele roda depois de `canTrade()`. Há teste estático para isso —
   qualquer caminho novo de ordem tem que passar pelo mesmo portão.

---

## 4. Backup (o cofre)

Toda alteração aprovada exige copiar os arquivos vivos para o cofre:

```bash
cp ws-otc-v14.mjs bot-config-v14.json diagnostic-results/bot-v14-tests.mjs diagnostic-results/bot-v14-relatorio.md oTrace.com/backup/
```

- `oTrace.com/backup/` — espelho da config viva (inclui `BOT-V14-MEMORIA.md`).
- `oTrace.com/backup/historico-2026-10-01-v14-inicial/`, `historico-2026-10-01-v13/`,
  `historico-2026-09-30/` — versões anteriores, preservadas.
- O backup **nunca** contém segredos além do que já está no config (login/senha da IQ ficam no
  `bot-config-v14.json`, que é o arquivo vivo).

---

## 5. Relatório com as evidências

`diagnostic-results/bot-v14-relatorio.md` — histórico de revisões, o que mudou em cada uma, a
reconstrução dos casos reais (SUI, Dogwifhat/TRON) e as medições feitas com candles reais.
