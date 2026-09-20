# RSI REVERSAL V2 — ESPECIFICAÇÃO COMPLETA (oficial do operador)

> Documento canônico da estratégia executada pelo Strategy Core V2 (congelado em `relay/rsi-skills-v2.mjs`).
> A infraestrutura (scheduler/timing) NÃO faz parte do core e é a atual (ACTIVE WATCH, PRIORITY_FINAL_WATCH,
> revalidação causal, safe cutoff, MISSED fail-closed, Execution Gate único).

## 1. Objetivo
Estratégia de **reversão confirmada**: o preço gera condição extrema e depois existem evidências de que
(1) o movimento anterior perde força, (2) o preço reage em região relevante, (3) surge pressão oposta,
(4) essa nova direção tem confirmação suficiente.

Fluxo: `EXTREMO → POSSÍVEL REVERSÃO → OBSERVAÇÃO → ENFRAQUECIMENTO DO ANTIGO → REAÇÃO DO NOVO → CONFIRMAÇÃO → REVALIDAÇÃO → ENTRADA`

Invariantes conceituais: `RSI extremo ≠ entrada` · `Bollinger tocada ≠ entrada` · `ADX caindo ≠ reversão` ·
`DI antigo enfraquecendo ≠ nova direção confirmada`.

## 2. Quatro elementos (funções distintas)
| Indicador | Função |
|---|---|
| RSI | Detecta condição extrema / inicia observação |
| Bollinger | Localização e comportamento do preço |
| +DI/−DI | Pressão direcional dominante e sua mudança |
| ADX | Força da tendência vigente (NÃO direção) |

## 3-5. RSI (detector)
- >= 70 → procurar reversão SELL; <= 30 → procurar reversão BUY. Nunca gatilho automático.
- Trajetória importa: acelerar ao extremo ≠ extremo + pico + perda de força + retorno.

## 6-13. Bollinger 20/2 (candles 5s ≈ 100s)
- Separação obrigatória: **EXTENSÃO** (chegou à banda) · **BAND RIDING** (acompanha a banda = continuação) ·
  **REJECTION / RE-ENTRY** (testou e voltou para dentro = evidência de reversão).
- Tocar banda não é reversão; sair da banda não é reversão; rejeição/re-entry é mais relevante que toque.

## 14-18. DMI
- +DI>-DI: pressão positiva dominante; −DI>+DI: negativa. Dominância ≠ ordem.
- O **movimento** dos DIs é essencial (ex.: −DI 42→38→32 com +DI 12→15→19 = transição).
- Cruzamento (+DI assume dominância) é sinal direcional mais forte do que apenas o DI antigo cair.

## 19-31. ADX
- Mede força, não direção. ADX subindo com −DI dominante fortalece a queda (perigoso para BUY).
- ADX caindo = perda de força do movimento antigo; **não** confirma a nova direção.
- Fases: A (antiga forte) → B (antiga enfraquecendo: interessante mas insuficiente) → C (nova pressão aparece)
  → D (nova assume; se ADX estabiliza/sobe com novo DI dominante = força da nova direção).
- ADX pode cair durante uma boa reversão. A unidade lógica é **DMI + ADX**, nunca ADX isolado.

## 32. Estado presente
A pergunta imediatamente antes da ordem: **"a V2 ainda aprova a tese AGORA?"** Se não: WAIT/CANCEL.
Tese ótima no passado não autoriza.

## 33-35. Episódio e estados
`NORMAL → RSI EXTREMO → EPISÓDIO ABERTO → WAITING CONFIRMATION → CONFIRMATION → ENTRY` (ou CANCEL/NORMAL).
- `PULLBACK_WAITING_CONFIRMATION` = contexto para observar, **NÃO AUTORIZADO**.
- `STRICT_*` = condições rígidas da lógica original. `WAITING ≠ STRICT`.

## 36-38. ACTIVE WATCH (infra)
- ~1 avaliação completa por candle de 5s (buckets reais; sem candidato passar vários candles sem avaliação).
- PRIORITY_FINAL_WATCH perto da janela final: decisão recente, nunca autorização velha.

## 39-42. Revalidação, causalidade, cutoff
- Antes do submit: a própria V2 reavalia o snapshot mais recente; se não aprovar → WAIT/CANCEL.
- Só dados disponíveis no instante podem decidir (sem candle futuro).
- Depois do safe cutoff **não entra**; MISSED é preferível a entrada atrasada; MISSED não é LOSS.

## 43-44. Fluxos
BUY: RSI sobrevenda → episódio → Bollinger (contexto/extensão/rejeição) → pressão vendedora mudando →
+DI reage → DMI/ADX confirma → STRICT → watch → priority → revalidação → cutoff → Gate → BUY PRACTICE.
SELL: espelhado.

## 45-46. Matrizes
- DMI/ADX (BUY): −DI dom+subindo+ADX subindo = queda fortalecendo; −DI caindo+ADX caindo = enfraquecendo (ainda
  não confirmado); −DI cai + +DI sobe = transição; +DI cruza = nova dominância; +DI dom + ADX estabiliza/sobe = força nova.
- Cenários Bollinger+DMI/ADX: (1) extremo + tendência forte = não vender automaticamente; (2) rejeição + antigo
  caindo + ADX caindo = candidato coerente; (3) queda enfraqueceu sem alta confirmada = ainda não; (4) rejeição +
  +DI assume dominância + ADX estabiliza = tese BUY consistente.

## 47-48. Evidência positiva ≠ ausência de evidência negativa
Confirmação exige evidência a favor (rejeição, RSI retornando, novo DI reagindo), não apenas ausência de contraindicação.

## 49-52. Auditoria
Congela `entrySnapshot` e audita causalmente; só depois revela settlement. WIN ≠ entrada boa; LOSS ≠ entrada ruim.
Exemplo V4 auditada: 31 operações, 16W/15L, 100% grade C, 16/16 THIN_WIN — olhar só o WIN esconderia fragilidade.

## 53. Counterfactual V2×V4
33 entradas V4 → V2: 0 ENTER, 31 WAIT/BLOCK, 2 INSUFICIENTE. Leitura correta: no instante exato da V4, a V2
ainda não tinha a própria confirmação — não é prova de que evitaria losses (evitaria também wins naquele instante).

## 54. Arquitetura atual (Strategy Core × Infra)
```
STRATEGY CORE (V2 original, congelado)      CURRENT INFRASTRUCTURE
RSI · Bollinger · DMI · ADX · episódios     ACTIVE WATCH · candle 5s · dedupe
confirmação                                 PRIORITY FINAL WATCH · revalidação causal
                                            safe cutoff · MISSED · Execution Gate
```
A V2 decide **SE** existe entrada; a infraestrutura decide **QUANDO** avaliar e **SE ainda há tempo seguro**.

## 55. Invariantes (25)
1 RSI detecta; não autoriza. 2 Sobrecompra ≠ SELL. 3 Sobrevenda ≠ BUY. 4 Tocar banda ≠ reversão.
5 Sair da banda ≠ reversão. 6 Band riding ≈ continuação. 7 Rejection/re-entry > toque. 8 DI dá direção relativa.
9 ADX não dá direção. 10 ADX subindo fortalece a direção vigente (ver quem domina). 11 ADX caindo ≠ confirmação oposta.
12 DI antigo caindo ≠ novo confirmado. 13 OLD WEAKENING ≠ NEW CONFIRMED. 14 Ausência de contra ≠ evidência a favor.
15 Passado cria candidato; presente precisa continuar válido. 16 WAITING_CONFIRMATION não autoriza. 17 Confirmação
velha não autoriza ordem atual. 18 Antes do submit a própria V2 precisa continuar aprovando. 19 Depois do safe
cutoff não entra. 20 MISSED > entrada atrasada. 21 WIN ≠ entrada boa. 22 LOSS ≠ entrada ruim. 23 Settlement nunca
participa retroativamente. 24 Nunca ajustar threshold olhando o que teria evitado LOSS. 25 Core e scheduler são
componentes separados.

## 56-57. Definição operacional
"RSI identifica episódio extremo, Bollinger contextualiza extensão e reação, DMI identifica perda de dominância
do antigo e surgimento do oposto, ADX contextualiza a força — o enfraquecimento do antigo nunca confirma sozinho
a nova tendência. A entrada só ocorre no estado original de confirmação do Core V2, ainda aprovado em revalidação
causal imediatamente anterior à execução, dentro da janela temporal permitida."
