# Relatório — Bot OTC V15 (`ws-otc-v15.mjs`)

> **ATUALIZAÇÃO 2026-10-02 (vale sobre este relatório):**
> 1. **`sell_profit` NÃO é líquido** — é a **DEVOLUÇÃO da recompra** (líquido = devolução − stake).
>    Comprovado no extrato `closed_options` da IQ (sonda `_probe-closed.mjs`): venda antecipada
>    marca `loose`/`equal`, nunca `win`; um win real devolve 3,64 para stake 2,00.
> 2. **A venda por reversão voltou — agora CONFIRMADA e A MERCADO** (regra do dono, 2026-10-02):
>    vende antes SÓ com confirmação de reversão contra a posição (tendência virou + RSI contrário
>    + velas contra + distância adversa). Como a IQ só manda cotação no abrir/fechar, a venda é a
>    mercado e o valor da recompra é lido no fechamento. O corte "só no fim/longe da linha" foi
>    removido. Depois de vender, o bot entra no sentido novo (gale de reversão) e a piramidagem
>    passou a exigir ADX mínimo e a parar com reversão formando. Ver `BOT-V15-MEMORIA.md` §14.

Data: 2026-10-01 · **V15: venda só por cotação real (nunca por reversão) + contabilidade
correta da venda + universo dinâmico com mínimo de 10 ativos operando + painel odômetro +
pausa de 5 min**. A V14 fica como histórico.

---

## 1. O diagnóstico das vendas (o que você viu ao vivo)

A regra da R8 (`sellReversed`) vendia **qualquer** op perdendo depois de 2 candles fechados
contra — sem olhar valor, tempo ou distância. Era exatamente a "venda de operação negativa"
que você viu: **corte por reversão, não por estar irreversível**.

Evidência na última sessão (17:48–17:52 UTC):

| Ativo | Abriu | Fechou | Vencimento era | Registro do bot |
|---|---|---|---|---|
| SUIUSD | 17:48:25 | 17:49:10 (45s) | 17:50:00 | loss −US$2, `earlySell:false` |
| SHIBUSD | 17:50:05 | 17:50:25 (20s) | 17:52:00 | loss −US$2, `earlySell:false` |
| TRON | 17:50:15 | 17:50:25 (10s) | 17:52:00 | loss −US$2, `earlySell:false` |
| WIFUSD | 17:51:25 | 17:51:35 (10s) | 17:53:00 | loss −US$2, `earlySell:false` |

- As 4 posições fecharam **muito antes do vencimento** e o dump `[🔎 RESPOSTA IQ]` do log **só
  liga quando o bot pede venda** — ou seja, a IQ **aceitou** as vendas (`sell-options`) e a
  posição fechou por causa delas.
- Mesmo assim o bot gravou **loss de −US$2 cheio**, porque:
  1. ele esperava o evento `sell-equal` — que **nunca chegou em nenhuma sessão registrada**;
  2. o fechamento por venda chega em **`socket-option-closed`**, e o parser genérico traduz
     "não-ganhou" como perda cheia;
  3. o bot **nunca leu a cotação real** da venda (`sell_profit`).
- Tradução: se aquela venda devolveu 1,66, o certo era **−0,34**, não −2 — o registro ficou
  pior que a realidade.
- O spam do log era o dump cru: 10s imprimindo **todas** as mensagens (só candles no recorte).

**Correção (V15):** a venda agora é decidida pela **cotação real** (`sell_profit`, que é
**LÍQUIDO** — documentado pelo MCP oficial: "net result if sold now, can be negative"), nunca
por reversão. E o corte de perda usa a sua régua: **só no fim da opção** e **só se estiver
LONGE da linha de win** (distância ≥ 4× o candle típico de 5s e a venda devolver ≥ 0,50).
**Perto da linha o bot espera.** Sem cotação fresca, não vende.

---

## 2. A V10 — o que foi investigado e o que foi salvo

Artefatos da V10 encontrados: `ws-otc-v10.mjs`, `bot-config-v10.json`, `resultados-v10.json`,
`v10-log.txt`, `relatorio-v10.json` — todos de **30/09, 10:54–11:05 local**. **Não existe
registro da sessão das 20h38** (o último arquivo de 30/09 é 17h27): provavelmente foi
sobrescrito pelas execuções seguintes. Não achei em nenhum JSON/log o "60 → 140 em 40 min".

O que os registros disponíveis mostram:

- **68 ordens em 11,5 min (5,9 ordens/min)** em 8 ativos, stake fixo 2.
- Mas **só 15 fecharam** e havia **múltiplas ordens no MESMO segundo no MESMO ativo**
  (ex.: 3 HYPE em 0,5s — 13:54:15.428, .621, .959). O `activeOps` era sobrescrito e o
  fechamento casava com a ordem errada. Parte do "muitas operações simultâneas" **era bug**.
- Relatório da janela: **WR 45,5%, lucro −3,80**.

**Salvado para a V15:**
1. **Universo amplo** (a V10/V11 operavam dezenas de OTCs; a V14 tinha travado em 10) →
   universo dinâmico: top 10 + reserva (DYDX, FARTCOIN, LINK, EOS, HBAR, SEI, IMX, PEN) +
   auto-fill, **mínimo 10 ativos operando, até 16**, com substituição de fechado/sem feed.
2. **Cadência**: sem trava artificial de ativos simultâneos (o freio é por ativo: ciclo do gale).
3. **A análise de expiração da V10** media WR por horizonte nos candles reais — 2 min teve o
   melhor resultado (87,5% na amostra dela). É a confirmação de manter **expiração 2 min**.

**NÃO salvado (era bug):** empilhamento de ordens no mesmo instante — a V15 garante **uma ordem
por vez por ativo** e o replay real mede `CALL+PUT simultâneos = 0`.

---

## 3. O que a V15 mudou

| Pedido | O que foi feito |
|---|---|
| "vender op negativa não pode acontecer" | Corte por reversão **removido por completo**. A venda segue a cotação real. |
| "vender op positiva com 50% do win / 1 real" | Realiza quando a cotação passar de **50% do win** (≈ +US$0,86 com stake 2 / payout 86%). |
| "se estiver muito longe, vende 1,50; se estiver perto da linha, espera" | Corte de perda só no fim (20–40s restantes), com **distância ≥ 4× o candle típico de 5s** (piso 0,05%) **e** devolução ≥ US$0,50. Perto da linha → espera. |
| "as operações estão chegando para todos os ativos?" | Sim: **todos os 10** disparam (replay). E agora o universo garante **no mínimo 10 ativos operando** (top + reserva + auto), revisão a cada 5 min. |
| "poucos ativos operando / pausa de 20 min" | Circuit breaker de 3 losses → **5 min** (era 20), com contador no painel. |
| "log odômetro, sem lista" | Painel de **uma linha** atualizada no lugar (candles, ops, W, L, vendas, WR, P/L, abertas, ativos, pausa). Lista por ativo e dump cru **removidos** (dump só com `IQ_SELL_DEBUG=1`, sem candles). |
| "a contabilidade da venda" | `sell_profit` é líquido: grava o valor real, marca `earlySell`, W/L pelo sinal; venda não aceita gera aviso de uma linha. |

Também: `[⚠️] sem ACK da IQ em 5s` (ordem pode não ter chegado), `iqoption-ws.mjs` limpo
(bloco morto removido; `[SEND]`/resumo do socket atrás de `IQ_WS_VERBOSE=1`) para nenhum log do
cliente quebrar o painel.

---

## 4. Evidências

- **51/51** testes offline verdes: `node diagnostic-results/bot-v15-tests.mjs`
  (venda por cotação com a régua de distância, universo dinâmico, guardas, estáticos de
  estrutura: 1 ponto de ordem, 1 ponto de venda, sem `sellReversed`, sem `close-position`;
  e os 2 novos da auditoria: queda de conexão no cliente WS avisa o bot / falha de boot não conta).
- **Replay com candles 5s reais** (`REAL=1 ...`, zero ordens): **79 entradas + 54 gales =
  133 ordens em 10 ativos**, `CALL e PUT juntos = 0`, bloqueios
  `semPullback 4266 | ordemAberta 2991 | lateral 1768 | rsi 329 | regime 103`.
- `node --check` nos 3 arquivos + config JSON OK.

---

## 5. O que só se confirma ao vivo (com você rodando)

1. O campo de cotação dentro de `open_options`: a V15 imprime **uma linha `[💱]`** na primeira
   posição aberta com os campos recebidos. Se o campo não for reconhecido, a venda automática
   fica **desligada** (fail-closed) e o mapeamento é ajustado com a evidência — sem chutar.
2. O comportamento real de uma **venda no lucro** e de um **corte no fim** (valores no
   `resultados-v15.json`: `earlySell`, `sellProfit`, `sellKind`, `profitSource`).
3. O painel odômetro em tempo real.

> O bot não recarrega sozinho: depois de qualquer alteração, reiniciar e conferir
> `[🧬] CÓDIGO V15 sha256:…` no boot.

---

## 6. Auditoria da lógica (2026-10-01) — gauntlet

Revisão integral do código antes do primeiro run. Nenhuma regra de negócio, config ou fluxo de
ordem/venda mudou — só defeitos reais e resíduo:

1. **Queda do WS deixava o bot zumbi.** O cliente (`iqoption-ws.mjs`) nunca emitia `close` para o
   bot: o `ws.on('close')` era **código morto**. Agora o cliente avisa quando a conexão estava
   READY (falha de boot não conta) e o bot imprime o resumo e sai. Coberto por teste offline.
2. **Dump `IQ_SELL_DEBUG=1` era código morto** (a janela nunca era aberta). Agora abre no pedido
   de venda (10s) — é a ferramenta para investigar a resposta da IQ ao `sell-options`.
3. **Erro no boot** virava unhandled rejection; agora `[FATAL]` + saída limpa (`onReady` com catch).
4. **Log do cliente WS** passou pelo painel (`logLine`) — antes podia quebrar a linha do odômetro.
5. **Resíduo removido**: `skipLogRemove()` vazia, contadores write-only (`skips`/`closed5s`/`signals`),
   parâmetro `now` morto em `evaluateEntry`, `shortUni` duplicando `shortName`, `if (LIVE)` e
   `if (row)` redundantes.

---

## 7. Arquivos

- `ws-otc-v15.mjs` (novo) · `bot-config-v15.json` (novo) · `iqoption-ws.mjs` (limpeza)
- `diagnostic-results/bot-v15-tests.mjs` (novo) · este relatório
- `BOT-V15-MEMORIA.md` (novo) · `AGENTS.md` §0.1 atualizado
- Cofre: `oTrace.com/backup/` (V15) + `historico-2026-10-01-v14-final/` (V14 preservada)

---

## 8. Atualização 2026-10-02 — venda por reversão + gale de reversão (build `2fae4889`)

- A venda antes do vencimento agora só acontece por **reversão confirmada contra a posição** e é
  **a mercado** (não existe cotação de meio de vida na IQ — medido ao vivo). O valor da recompra
  é lido no fechamento (`profitSource: close_sell_return`).
- **Gale de reversão**: depois de vender, o bot entra no **sentido novo** dentro da janela do
  gale. Correção medida ao vivo: o ramo do gale passou a vir **antes** dos portões da entrada
  normal — no build anterior o gatilho armava e não entrava (SUIUSD/TRUMPUSD, log `revgale.log`).
- **Piramidagem** agora exige `ADX >= adxMin` e para quando a reversão está se formando
  (caso Polkadot: 3 CALLs com ADX 23,0 → 20,7 → 16,1).
- Suíte offline: **70/70** (`node diagnostic-results/bot-v15-tests.mjs`).

---

## 9. Ciclo de 3 ordens: entrada + pirâmide extrema + martingale 2,75× (2026-10-02)

- **Pirâmide** (2ª posição no mesmo sentido): só com `ADX ≥ 25` **e** RSI no extremo A FAVOR
  (CALL ≤ 35 / PUT ≥ 65) **e** sem reversão se formando. `pyramidMax = 1` → no máximo **2
  posições simultâneas**; senão, uma compra só.
- **Martingale**: a 3ª ordem do ciclo, a única acima do stake fixo, valendo `2,75 ×` a soma das
  posições vendidas por reversão (1 de 2,00 → 5,50; 2 → 11,00). **Um por sequência** — perdeu,
  volta à base; e ele **não arma outro martingale** (nunca compõe).
- **Expiração 2 minutos** (era 5) — decisão do dono, como no run que subiu a demo de 60 para 145.
- **Furo encontrado ao vivo e corrigido:** no build `f502f426` a ordem de 5,50 foi vendida por
  reversão e armou **15,13** (2,75 × 5,50) — a mesma escada composta que zerou a conta do V13
  antigo. Guarda nova: só ordem de stake base arma o martingale, e fechar o martingale zera o
  ciclo (`applyResult`).
- **Evidência ao vivo (demo):** `SHIBUSD PUT US$2.00` → venda por reversão (devolveu 0,22) →
  `SHIBUSD CALL US$5.50 (MARTINGALE 2.75x)`. Boot `bf1d085f`.
- **Forense do run de 30/09 (60 → 145):** era o **V13 "learning"**, não o V10 — whitelist de 10
  ativos com direção fixa + reversão à média (`fade4`) em regime `ranging` + martingale 2,75× + 2
  minutos. Detalhes e ressalvas em `BOT-V15-MEMORIA.md` §16.
