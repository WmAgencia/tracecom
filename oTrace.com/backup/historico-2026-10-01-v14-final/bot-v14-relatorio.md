# Relatório — Bot OTC V14 (`ws-otc-v14.mjs`)

Data: 2026-10-01 · Revisão 8: **CICLO DO GALE de verdade (1 entrada + até 2 gales, o gale entra DEPOIS do loss e não exige pullback — antes as 2ª/3ª ordens eram reforço na continuação, que só empilhava ordem no ativo) + venda corrigida e imediata na reversão (`sell-options`) + todos os ativos operando ao mesmo tempo, sem limite + uma ordem por vez por ativo + nunca CALL e PUT juntos + teto de exposição como FRAÇÃO DO SALDO + circuit breaker + trava de perda da sessão + stake fixo em 2**.
Revisões anteriores: R7 venda corrigida; R6 um ativo = uma ordem; R5 um lado por ativo, reversão vende e espera; stake fixo.

---

## 0.5 O gale de verdade (revisão 8)

Até aqui as 2ª e 3ª ordens no mesmo ativo eram **reforço na continuação**: entravam quando a ordem
anterior ainda estava **aberta e ganhando** e o preço seguia a favor. Isso não recuperava nada e era
o que empilhava a tela de 3 CALLs de $6 no Dogwifhat.

O ciclo correto (o que o dono descreveu) é o do **gale**:

```
1ª ordem (entrada no pullback)
   ├─ win                            → ciclo fecha, ativo livre
   └─ loss (venceu ou foi cortada     → GALE: volta no MESMO ativo em até galeWindowMs
      na reversão)                       SEM exigir pullback novo (o mercado acabou de
                                         andar contra), no sentido da tendência daquele
                                         momento, ainda no valor base (2)
                                          ├─ win  → ciclo fecha
                                          └─ loss → 2º e ÚLTIMO gale (3 ordens = teto)
                                                       └─ loss → ciclo fecha e espera
```

Regras que garantem o resto:

- **Uma ordem por vez no ativo.** Com ordem aberta o bot só tem uma ação: **vender** se houver
  reversão. Nunca abre a segunda ordem com a primeira viva.
- **O teto continua sendo 3** (`trading.maxOpsPerAsset`): 1 entrada + no máximo 2 gales. O 4º
  pedido no ciclo devolve `cicloFechado`.
- **O gale não escala valor.** Continua 2 — o ciclo do gale existe, a escada 2 → 4,33 → 9,36 não
  (`martingale.levels: 0`).
- **O gale respeita o guarda-corpo de RSI** (não compra no topo, não vende no fundo) e o regime.
- **A janela é curta** (`galeWindowMs: 120000`): passou disso sem entrar, o ciclo fecha e o ativo
  volta a esperar o pullback normal.

**Evidência no replay com candles reais (10 ativos, ~833 min-ativo):**
`77 entradas + 54 gales = 131 ordens`, **0 de dois lados**, bloqueios
`semPullback 4212 | semReversao 2332 | lateral 1795 | rsi 383 | regime 95`.

> Também nesta revisão: o resumo final passou a explicar a diferença entre `Lucro (bot)` e
> `Lucro (real)` — a variação de saldo inclui as ordens ainda abertas (`⏳`), o que confundia o P/L.

---

## 0.4 A venda não acontecia (revisão 7) — o bug mais caro

Na sessão de 14:13-14:18 o bot fez exatamente o que devia na detecção e **mesmo assim perdeu**:

```
[✂️ EARLY SELL] RAYDIUMUSD | PUT | 3 candles contra (2.8xx o movimento médio) | restam 70s | tentativa 1/3
[SEND] close-position {"position_id":14313609990}
...70s depois...
[❌] RAYDIUMUSD | PUT | LOSS | P/L: -US$2.00
```

A IQ **não respondeu nada** ao pedido de venda e a opção seguiu até o vencimento. Causa raiz: a
mensagem estava errada. Os clientes de referência (`github.com/iqoptionapi/iqoptionapi`, que o
próprio `iqoption-ws.mjs` cita no cabeçalho, e a lib JS `LuKks/iqoption`) vendem com
**`sell-options`** e corpo **`{ options_ids: [id] }`**. `close-position` com `position_id` a IQ
**ignora em silêncio** — sem erro no socket, sem evento, nada. Vendeu zero em toda a história
deste bot.

**Três correções:**

1. `sellOption()` (em `iqoption-ws.mjs`) agora manda `sell-options` / `options_ids`. Há **teste
   estático** que falha se `close-position` voltar ao código.
2. **Um gatilho só para vender.** Antes existiam dois: a reversão (2 candles contra) só logava, e
   um "early sell" separado exigia **3 candles contra + movimento ≥ 1,5× a média + janela de 100s**.
   O resultado era o que você viu: o bot entendia a reversão e **não vendia** (ou vendia 30-60s
   depois, com o preço já perdido). Agora a reversão **chama a venda na hora** — `sellReversed()`.
   Não vende só dois casos: ordem **no lucro** (deixa vencer) e faltando **menos de 20s**.
3. **Diagnóstico automático:** depois de pedir uma venda, o bot imprime **cru** por 10s cada
   mensagem que a IQ manda (`[🔎 RESPOSTA IQ] <nome> {...}`), e avisa
   `[⚠️] ... fechou sem a venda pedida` se a ordem fechar sem confirmação. Se algum dia a venda
   parar de funcionar, o log diz qual evento a IQ mandou.

Também nesta revisão: a **transparência das ordens** — o `orderId` passou a ser gravado no
`resultados-v14.json` (antes ficava vazio) e uma abertura que não casa com ordem local deixou de
sumir em silêncio (foi o caso do ORDIUSD desta sessão).
Base: V13 corrigida + auto-flip real + early sell por reversão + martingale por payout.

---

## 0. O que mudou nesta revisão (o seu pedido)

| Pedido | O que foi feito |
|---|---|
| "o regime tava de alta e ele deu sell — operação burra" | **A direção agora vem da tendência do mercado**, não de uma direção fixa por ativo. Alta → compra CALL no pullback; baixa → vende PUT no repique. A whitelist virou só referência. |
| "eu teria comprado ali com martingale" | A entrada é o **pullback contra a tendência** (4 candles contra + 1 de volta) — exatamente a linha azul: dip dentro da alta, com RSI confirmando que o preço recuou. Testado com janela real de 5s. |
| "múltiplas operações por ativo, até três" | **Até 3 ordens por ciclo no mesmo ativo** (1 entrada + 2 adicionais no mesmo sentido), com espaçamento e exigência de **novo extremo** (só quando continua subindo/descendo de verdade). |
| "se vê reversão, vende rápido" | **Flip**: tendência virou contra as ops abertas + 2 candles contra → opera no sentido novo **na hora** (não espera cooldown). Máx. 1 flip por ciclo. |
| "warm-up ao mínimo seguro" | `warmupMs: 30000` → **5000** (= 1 candle de 5s; o histórico do boot já traz ~119 candles). |
| **"é sempre 2 reais — não pode operar 9,36"** | **Escada de martingale desligada**: `martingale.levels: 0` → o valor de **toda** ordem é a base (2), inclusive nas adicionais do mesmo ativo. Não existe mais 4,33/9,36, e um loss também não pausa o ativo. |
| **a 2ª venda do SUI não tinha motivo** | Causa encontrada e corrigida: o **adicional não tinha o guarda-corpo de RSI** que a entrada tem, então ele reforçava a venda com o mercado já no fundo. |
| **CALL e PUT abertos juntos no mesmo ativo** | Era o flip da revisão anterior: ele abria o lado novo **sem fechar** o antigo. Agora **um ativo só tem um lado por vez** (trava dura), e a reversão passa a **vender o que está perdendo e esperar** em vez de abrir o lado oposto. |
| **o saldo caiu rápido (62 → 54 em ~1 min)** | Nova **trava de perda da sessão**: perdeu 20% do saldo inicial, o bot para de abrir ordem nova (as abertas fecham sozinhas) e só volta reiniciando. |

---

## 0.3 A trava estrutural (revisão 6) — por que as telas não podem mais acontecer

As suas três telas (13:58, 13:59, 14:00) mostravam duas coisas ao mesmo tempo:

| Tela | Ativo | O que aparecia |
|---|---|---|
| 1 | Dogwifhat | **3 CALLs = US$6** + 1 PUT = US$2 (4 ordens no MESMO ativo) |
| 2 | TRON | **2 CALLs + 2 PUTs** = US$8 |
| 3 | TRON | 2 CALLs de US$2 + 1 PUT de US$2 (e o saldo 62 → 56 → 54) |

O problema não era falta de trava: era o **modelo**. O bot pensava "quantas ordens eu ainda posso
empilhar neste ativo?" (até 3) e "quanto eu já tenho na mesa?" (**US$40**) — numa conta de US$62 isso
são **65% do saldo em risco**. Com esse modelo, uma sequência ruim na mesma direção pode consumir a
conta inteira. Foi trocado por três regras, não por mais um remendo:

1. **UM ATIVO = UMA ORDEM** (`trading.maxOpsPerAsset: 1`). Ordem aberta no ativo → o ativo não recebe
   outra, seja do mesmo lado ou do lado oposto. Some o empilhamento de 3 CALLs de US$6 e some o
   CALL+PUT simultâneo — os dois casos ficam impossíveis pela mesma trava (`maxOps` e `ladoOposto`
   em `evaluateGuards()`, a função pura que toda ordem atravessa).
2. **TETO DE EXPOSIÇÃO = FRAÇÃO DO SALDO** (`risk.maxExposurePct: 10`). Não existe mais o número
   absoluto de US$40: o teto é 10% do saldo **atual** (10% de 60 = 6 = 3 ordens de 2). Quando a conta
   cai, o teto cai junto — é a proteção clássica contra ruína, e é automática.
3. **CIRCUIT BREAKER** (`risk.stopAfterConsecutiveLosses: 3`, pausa de 20 min). Três losses seguidos
   (win zera a contagem, empate não conta) e o bot **para de abrir** por 20 minutos. É a resposta direta
   ao saldo 62 → 54 → 48: uma sequência ruim não continua até o fim da conta, ela para o bot.

Somado ao que já existia: **um lado por ativo** (trava dura), **reversão vende e espera** (não abre o
lado oposto), **stake sempre 2** e **trava de perda da sessão** (20% do saldo inicial).

**Como conferir que é ESTE código que está rodando:** o boot agora imprime
`[🧬 CÓDIGO] R6 sha256:xxxxxxxx`. Se a tela (ou uma ordem no `resultados-v14.json`) mostrar outro
hash ou outra stake, o bot em execução é código antigo — **o bot não recarrega sozinho, tem que
reiniciar**. Cada ordem gravada leva o campo `rev`, então o histórico diz qual revisão a abriu.

**Prova no replay com candles reais:** `CALL e PUT abertos ao mesmo tempo no mesmo ativo: 0`
(o replay sai com erro se aparecer 1).

> **Atualização da revisão 7:** o teto voltou a ser **3 ordens por ativo** (1 entrada + máx 2 gales,
> conforme você pediu) e **não existe mais limite de ativos simultâneos** — todos os 10 ativos
> operam ao mesmo tempo. O que continua valendo aqui é a proibição de **CALL e PUT no mesmo ativo**
> e o teto de exposição em **% do saldo** (agora 50%, a última linha de defesa: o dono quer todos os
> ativos operando e não quer um número absoluto travando o dia a dia).

---

## 0.2 Dois lados ao mesmo tempo — o erro da revisão anterior

As telas de 13:58/13:59 mostravam, no mesmo ativo:

```
DOGWIFHAT  3 CALLs (US$6) + 1 PUT (US$2)   <- CALL e PUT juntos
TRON       2 CALLs (US$4) + 2 PUTs (US$4)  <- CALL e PUT juntos
```

Isso não era azar: era o **flip** que eu tinha implementado na revisão anterior. Ele detectava a
reversão e **abria o lado novo sem fechar o antigo** — assumindo que a venda antecipada ia fechar o
primeiro lado, o que nem sempre acontece (a venda antecipada só age numa janela e com critério).

Segurar os dois lados é **prejuízo estrutural**: com payout de 86%, um par 2+2 tem sempre um lado
perdendo 2 e o outro ganhando no máximo 1,72 — e existe uma faixa de preço em que **os dois perdem**.

**Corrigido em duas camadas:**

1. **Estrutural:** a reversão não abre mais nada. Ela manda **vender** o que está perdendo e espera o
   ativo limpar; o ciclo novo só começa (no sentido que a tendência apontar) quando não há op aberta.
2. **Trava dura testável:** `evaluateGuards()` recusa qualquer ordem contra uma op já aberta no mesmo
   ativo (`ladoOposto`), antes de qualquer outra trava. É a última linha de defesa se algum caminho
   mudar no futuro.

**Prova no replay com candles reais:** `CALL e PUT abertos ao mesmo tempo no mesmo ativo: 0`.

---

## 0.1 O caso do SUI (a 2ª venda de 9,36) — reconstruído nos dados reais

Reconstruí a sequência nos candles de 5s do próprio SUI (achei os dois candles pelas aberturas que
apareciam na tela, 1.07773 e 1.07346 — 16:47:45 e 16:48:15 UTC):

```
16:46:40  RSI 21,7  ← queda violenta
16:46:50  RSI 15,4
16:47:20  RSI  4,7  ← fundo do movimento (RSI quase zero)
16:47:30  RSI 19,4  ← repique começa
16:47:35  RSI 43,9  ← 3 candles fechados CONTRA uma venda
16:47:45  RSI 45,0  ← 1ª venda (1.07773) sai aqui
16:48:00  RSI 38,5  ← adicional disparava aqui
16:48:05  RSI 31,1  ← adicional disparava aqui
16:48:15  RSI 32,7  ← A 2ª VENDA DA TELA (1.07346) saiu aqui
16:48:25  RSI 41,4  ← preço em 2 min: −0,022% (uma venda aqui GANHA)
```

O preço em 2 min de cada ponto mostra o prejuízo que você viu: a venda de 16:48:15 estava com o
mercado em **RSI 32,7** e o preço subiu (+0,034% → loss). A venda de 16:48:25 (RSI 41,4, já fora do
fundo) caiu (−0,022% → win).

**Causa raiz:** o guarda-corpo de RSI só existia na **entrada** (`CALL <= 60 / PUT >= 40`); o
**adicional não checava nada** — dava para reforçar uma venda com o mercado em RSI 31. Não era o
filtro de regime nem a tendência: era um buraco no caminho do adicional.

**Corrigido** — repassando o mesmo caso pelo código novo:

```
[PUT aberta] 16:48:00 RSI 38,5 -> rsi    (bloqueado)
[PUT aberta] 16:48:05 RSI 31,1 -> rsi    (bloqueado)
[PUT aberta] 16:48:15 RSI 32,7 -> rsi    (bloqueado)  ← a 2ª venda da tela não acontece
[PUT aberta] 16:48:20 RSI 36,2 -> rsi    (bloqueado)
[PUT aberta] 16:48:25 RSI 41,4 -> adicional          ← 1º reforço só depois de sair do fundo
```

E a **reversão** deixou de esperar a EMA: antes ela precisava da média já virada (que só virou às
16:49:30, 45s depois de o preço já ter subido), agora 2 candles contra já viram o lado.

> Honestidade: das duas mudanças, quem salvou **este** caso foi o guarda-corpo de RSI. O flip de
> reversão mediu 53,0% de acerto (n=576) contra 48,2% dos adicionais — é melhor, mas é uma aposta de
> moeda levemente viciada, não uma garantia: naquele ponto exato (16:48:50) o flip teria perdido.

---

## 1. Como rodar

```bash
cd "D:/Tracecom project"
node ws-otc-v14.mjs demo     # conta DEMO (type 4, id 1250741747, saldo em US$)
node ws-otc-v14.mjs real     # conta REAL (type 1, id 1250741746 — hoje sem saldo disponível)
node ws-otc-v14.mjs demo --ativos   # lista os ativos turbo
```

Testes: `node diagnostic-results/bot-v14-tests.mjs` (34 checagens, sem rede) —
`REAL=1 node diagnostic-results/bot-v14-tests.mjs` (+ replay com candles reais dos 10 ativos).

Arquivos: `ws-otc-v14.mjs` · `bot-config-v14.json` · estado `bot-state-v14.json` · resultados `resultados-v14.json`.

---

## 2. Como o bot decide agora

```
candles 5s fechados
   │
   ├─ TENDÊNCIA (EMA8 últimos 12 vs EMA21 últimos 40, em % do preço)
   │     spread >= +0,05%  →  alta  (só CALL)
   │     spread <= -0,05%  →  baixa (só PUT)
   │     entre os dois     →  lateral → NÃO entra
   │
   ├─ FLIP (se já tem op aberta no sentido oposto)
   │     tendência virou + 2 candles fechados contra → abre no sentido novo
   │
   ├─ ENTRADA (sem op aberta)
   │     pullback 4+1 na direção da tendência + RSI de guarda-corpo
   │
   └─ ADICIONAL (já tem op aberta no mesmo sentido)
         ciclo < 3 ordens + novo extremo a favor + 30s desde a última
```

- **Só candle FECHADO** entra na conta. A vela em formação nunca gera ordem.
- **Ciclo**: quando a 3ª ordem é atingida, o ativo para de adicionar e só volta a
  operar depois que **todas** as ops fecharem (senão viraria metralhadora de ordens —
  medi: sem essa trava o replay abria 515 adicionais em 85 min).
- **Cooldown** (15s depois de win / 5s depois de loss) vale **entre ciclos**; os adicionais
  do mesmo ciclo usam `trading.addOnSpacingMs`.

---

## 3. Status de cada recurso

| Recurso | Status | Como funciona |
|---|---|---|
| **Stake fixo (sem escalada)** | ✅ | `martingale.levels: 0` → **toda ordem vale a base (2)**. O valor não sobe depois de loss: a recuperação é a própria repetição no mesmo ativo, sempre no mesmo valor. Trava por ordem **20** e trava de exposição somada **40**. |
| **Martingale (escada)** | ⛔ desligado | a escada **2 → 4,33 → 9,36** existia aqui e foi desligada a seu pedido. Fica implementada: `martingale.levels: 2` religa (cada degrau vencedor cobre o perdido e fecha +1,72; 3 losses pausava o ativo). |
| **Auto-Flip** | ✅ (novo sentido) | virou **flip por reversão do mercado** (tendência invertida + 2 candles contra), rápido de propósito. **Não existe mais** "virar depois de 2 losses": inverter contra a tendência era exatamente o que fazia o bot dar sell no meio de uma alta. |
| **Early Sell** | ✅ | vende antes do vencimento **só quando o preço está revertendo contra a posição** (3 candles contra + movimento ≥ 1,5× a média). Trajetória a favor → **não vende**, deixa o win. Olha **todas** as ops do ativo. |
| **RSI Filter** | ✅ (recalibrado) | **guarda-corpo**, não seletor: não compra com RSI já esticado acima de **60**, não vende com RSI abaixo de **40**. |
| **Regime Filter** | ✅ | bloqueia quando há **10+ candles seguidos na mesma direção** dentro dos últimos 20. |
| **Kill WR** | ⛔ removido | a seu pedido. |
| **IC-WR Gate** | ❌ não aplicado | não existe no V14 (explicação na seção 6). |
| **Múltiplas ops por ativo** | ✅ (revisão 7) | `trading.maxOpsPerAsset: 3` → **1 entrada + no máximo 2 gales**, sempre no mesmo sentido, com espaçamento e exigência de preço novo extremo. A 4ª ordem no ativo é recusada. |
| **Ativos simultâneos** | ✅ sem limite (revisão 7) | Todos os 10 ativos operam ao mesmo tempo, cada um com o seu teto de ordens. Não existe `maxConcurrentOps`. O freio global é o teto de exposição em % do saldo. |
| **Circuit breaker** | ✅ nova (revisão 6) | `risk.stopAfterConsecutiveLosses: 3` losses seguidos → 20 min sem abrir ordem nova. |
| **Um lado por ativo** | ✅ nova (trava dura) | `evaluateGuards()` recusa ordem contra op aberta no mesmo ativo (`ladoOposto`). Nunca mais CALL + PUT juntos. |
| **Reversão** | ✅ (novo sentido) | preço anda 2 candles contra a op → **manda vender** o que perdeu e espera limpar. Não abre o lado oposto. |
| **Trava de exposição** | ✅ (revisão 6) | `risk.maxExposurePct: 10` — a soma de TODAS as ordens abertas nunca passa de **10% do saldo atual** (não existe mais o teto absoluto de 40). |
| **Trava de perda da sessão** | ✅ nova | `risk.maxSessionLossPct: 20` — perdeu 20% do saldo inicial, para de abrir ordem nova até reiniciar. |

---

## 4. Regime Filter (explicação) — e o bug que achei nele

Olha os últimos 20 candles de 5s e conta a **maior sequência** de fechamentos na mesma direção.
Se for **≥ 10** → `trending` → entrada bloqueada naquele ativo (movimento já esticado; o pullback
vira reversão de verdade). Abaixo de 10 → `ranging`, liberado.

- Config: `strategy.regimeStreakThreshold: 10`, `strategy.lookbackRegime: 20`.
- No log de 60s aparece como `blocos: regime:N`.
- **Bug corrigido:** candle com preço **igual** era contado como queda (`close > anterior ? 1 : -1`),
  então um mercado **parado** virava `trending` e bloqueava tudo. Agora igual não conta como sequência.
- **Honestidade sobre o alcance:** medindo nas cotações reais, o streak ≥ 10 **nunca** aparece no
  momento exato de uma entrada (0 de 104), porque o próprio pullback quebra a sequência. Ou seja,
  ele é raro por natureza — mantive o valor que você definiu. *(Curiosidade medida: streak ≥ 5 no
  momento da entrada acertou 40,8% contra 63,6% de quem tinha streak < 5 — mas com n=49/55 e
  padrão não-monotônico nos outros limiares, é pouco para reescrever a estratégia. Se quiser, é
  só baixar o limiar no config.)*

---

## 5. Evidências medidas (cotações reais de 5s, 10 ativos)

**Base:** 9360 janelas de 5s, movimento de referência em 2 min = **49,9% para cima** (moeda justa).

### 5.1 A direção fixa era o problema

| Regra | Sinais | Acerto |
|---|---|---|
| Direção **fixa da whitelist** + fade4 + RSI 35/65 (como estava) | 182 | 52,2% |
| **Direção da tendência** + pullback + RSI 60/40 | 105 | 52,9% |
| Direção da tendência + pullback **sem gate de RSI** | 221 | 55,4% (54,0 CALL / 56,8 PUT) |

O ganho principal não é o número — é **não operar contra a maré** (o sell na alta que você marcou).
Todos os intervalos de confiança ainda são largos: nada aqui é um edge comprovado.

### 5.2 O gate de RSI 35/65 estava matando o bot

| Gate | CALL | PUT | Total |
|---|---|---|---|
| **35/65 (o original)** | 0 | 1 | **1 em 9360 janelas** |
| 50/50 | 24 | 11 | 35 |
| **60/40 (novo)** | 62 | 43 | 105 |
| sem gate | 126 | 95 | 221 |

Pedir `RSI ≤ 35` **dentro de uma alta** é contraditório — o bot praticamente não disparava.
Por isso o RSI virou guarda-corpo em 60/40 (não compra já esticado, não vende já esticado).
Para voltar ao 35/65 é só mudar `strategy.rsiCallMax/rsiPutMin`.

### 5.3 Replay com candles reais (sem cooldown/saldo: é um **teto**)

83 min de mercado por ativo (1000 candles de 5s, o máximo que a IQ entrega por chamada):

```
95 entradas + 0 adicionais = 95 ordens em ~833 min-ativo | 476 avisos de reversão (mandou vender)
CALL e PUT abertos ao mesmo tempo no mesmo ativo: 0   <-- tem que ser 0
bloqueios: semPullback 5257 | lateral 2213 | cicloFechado 1376 | rsi 98 | regime 75
```

A evolução das rodadas mostra onde cada correção agiu:

| rodada | entradas | adicionais | "flips" | dois lados juntos |
|---|---:|---:|---:|---:|
| antes do RSI no adicional | 75 | 102 | 50 | (não medido — o flip abria o lado novo) |
| com RSI no adicional | 86 | 74 | 85 | sim, direto |
| um lado por ativo (rev. 5) | 88 | 107 | 0 | 0 |
| **um ativo = uma ordem (rev. 6)** | **95** | **0** | **0** | **0** |

O número que importa não é a contagem de ordens, é a **concentração**: na revisão 5 ainda era possível
chegar a 3 ordens no mesmo ativo (US$6), que é exatamente a tela do Dogwifhat; agora **0 adicionais** e
o teto de exposição em % do saldo governam tudo. As entradas subiram de 88 para 95 porque o ativo que
antes empilhava adicional agora espera e reabre um ciclo novo — mais oportunidades, cada uma com 1/3
da exposição de antes.

Ou seja: o bot **opera de verdade** (o "0 operações" era o warmup sem histórico, corrigido na
revisão anterior) e fica **seletivo** — descarta a maior parte dos candles. Ajuste fino em
`risk.maxExposurePct`, `trading.maxConcurrentOps` e `cooldown.*` se quiser mais/menos atividade.

---

## 6. IC-WR Gate (explicação) — e o Kill WR

**Kill WR**: desabilitava o ativo quando o WR observado caísse abaixo de 45%. Era corte por **ponto
estimado** — com 10-15 operações o WR oscila muito, então podia remover um ativo bom por azar.
Você pediu para não manter: **removido**.

**IC-WR Gate**: a versão estatística. Em vez do WR direto, calculava o **intervalo de confiança de
Wilson (95%)** e cortava só quando o **limite inferior** ficava abaixo de 50%. Exemplo: 6 acertos em
10 → WR 60%, mas o limite inferior do IC é ~31% → o gate bloquearia, porque com 10 operações você
não pode afirmar que o ativo ganha mais de 50%. Com 60 de 100 → WR 60% e limite inferior ~50% →
mantém.

**Estado atual: não aplicado.** Se quiser, é uma função pura pequena (Wilson + uma checagem) com
um interruptor no config e um mínimo de operações (sugiro 20) antes de valer.

---

## 7. O que olhar nos primeiros minutos

```
[🔁] Histórico: 10/10 ativos com dados suficientes     ← preload (sem espera de 2 min)
[🧬 CÓDIGO] R6 sha256:xxxxxxxx | confira este hash na tela   ← é isto que prova qual código roda
[🛡️ RISCO] STAKE FIXO US$2.00 por ordem | teto por ordem US$20 | exposição máx 50% do saldo (US$30.00 agora)
[🧮 POSIÇÃO] TODOS os ativos operando ao mesmo tempo (sem limite de ativos) | até 3 ordens por ativo, SEMPRE no mesmo sentido
[✂️ VENDA] ON — 2 candles fechados contra a ordem → manda vender na hora (sell-options)
[🛑 FREIOS] reversão após 2 candles contra → vende e espera | circuit breaker 3 losses seguidos → 20min parado | trava de perda da sessão 20%
[⏳] warmup 5s | DIREÇÃO = tendência (EMA8x21, mínimo 0.05%) | ...   ← config em uso
[✅] OPERANDO R6 — direção pela tendência, 1 ordem(ns) por ativo no mesmo sentido ...
[📡] Atividade:  [2290] RENDERUSD  CALL    +0,14% | 5s:119/20 1m:29/1 | ops:1 | 3 sinais | blocos: ...
[📤 ORDEM] RENDERUSD | CALL | US$2.00 | tendência alta 0.14% | exp:1790871480
[✅ ABERTA] RENDERUSD | CALL | US$2.00 | id:14287...
[❌] RENDERUSD | CALL | LOSS | P/L: -US$2.00 | abertas: 0
[✂️ VENDIDA] ... devolvido US$1,00 de US$2,00 | P/L: -US$1,00
[✂️ VENDA] RAYDIUMUSD | PUT | reversão: 2 candles contra PUT | entrada 0.71 → agora 0.72 | restam 100s | tentativa 1/4
[🔎 RESPOSTA IQ] <nome do evento que a IQ mandar> {...}   ← aparece cru por 10s depois da venda
[✅ VENDIDA] ... / [↩️ REVERSÃO] ... NÃO vendeu: ainda no lucro / [🛑 CIRCUIT BREAKER] 3 losses seguidos
```

Checagem de sanidade em 10 segundos, olhando a tela do bot: **(a)** o `[🧬 CÓDIGO]` bate com o arquivo
que você rodou (se não bate, está rodando código velho — reinicie); **(b)** nunca aparece o mesmo ativo
duas vezes na lista de posições; **(c)** nunca aparece CALL e PUT do mesmo ativo.

Pontos de atenção na primeira sessão:
1. **Casamento das ordens.** A ordem é atribuída pelo **id da posição** (quando a IQ manda), depois pelo
   `requestId` e, por último, à mais antiga do ativo. Com uma ordem por ativo isso quase não tem espaço
   para errar. Se algum fechamento aparecer como `[❓ FECHAMENTO SEM ORDEM LOCAL]`, me mande a linha.
2. **Valor do early sell.** A IQ pode mandar o valor bruto ou líquido; assumi bruto. O campo fica
   gravado em `sellProfit` em cada resultado.
3. O `[IQ-WS]` agora é **1 linha por minuto** (detalhe com `IQ_WS_VERBOSE=1`).

> Observação de escopo: o motor oficial tracecom (V3, congelado) **proíbe martingale**; este bot é um
> script separado, como você pediu. As duas coisas não se misturam.
