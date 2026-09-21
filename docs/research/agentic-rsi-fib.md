# Agentic RSI+FIB — pesquisa profissional (fonte para os agentes)

> Base: literatura profissional de RSI (Wilder 1978; Fidelity/CMT), Bollinger (John Bollinger, "Bollinger on Bollinger Bands"),
> ADX/DMI (Wilder), ATR (Wilder) e Fibonacci (retracements de swing). Cada agente implementa SOMENTE as regras do seu indicador.

## RSI (agente RSI) — gatilho da oportunidade
- Wilder 14. **70/30 são ALERTAS, não ordens.** Em tendência forte o RSI fica >70/<30 por muito tempo (fade cego = prejuízo).
- Hierarquia de sinais (maior→menor valor): **divergência no extremo** > **failure swing** > RSI S/R em tendência > cruzamento da linha 50 (filtro) > extremo em range confirmado.
- **Divergência**: preço faz HH e RSI faz LH (bearish) / preço LL e RSI HL (bullish). O segundo extremo deve estar FORA de 30–70 (senão é ruído). É AVISO, não gatilho — exige confirmação estrutural.
- **Failure swing**: topo >70 → recua → falha em superar → rompe o fundo intermediário (bearish); espelho no fundo (bullish).
- **Crossback**: romper de volta para dentro (70↓ / 30↑) após excursionar é o sinal acionável — não o toque.
- Linha 50 = filtro de lado (comprar só acima de 50; vender só abaixo).

## Bollinger (agente Bollinger) — contexto/regime
- SMA20 ± 2σ. **Toque ≠ sinal.** Fechar FORA = continuação primeiro (rule: "tags are not signals; outside closes are continuation first").
- Regimes: **SQUEEZE** (BandWidth no fundo do range recente) · **WALK** (5+ fechamentos do mesmo lado da média, %B>0.8/<0.2 — tendência; fade é armadilha) · **RANGE** (%B oscilando 0.2–0.8, média plana → mean reversion viável).
- **%B** = (close−lower)/(upper−lower); **BandWidth** = (upper−lower)/middle. Divergência preço×%B é evidência forte de perda de força.
- Reversão para a média exige: rejeição/reentrada + média NÃO inclinada + sem walk. Walk contra a tese = bloqueio duro.

## ADX/DMI (agente ADX) — força e direção
- DMI dá direção (+DI vs −DI, slopes, cruzamento); **ADX dá força, nunca direção**.
- Regime: ADX <20 = range (mean reversion viável); ADX >25 = tendência (não fade); ADX subindo com DI antigo dominante = continuação.
- INVARIANTE: enfraquecimento do DI antigo NÃO confirma reversão — exige reação do DI oposto (slope/dominância).

## ATR (agente ATR) — volatilidade
- ATR normalizado (ATR/close) vs mediana recente: mercado **morto** (movimento pequeno = sem edge), **normal**, **ruidoso**.
- ATR expandindo + RSI extremo + ADX subindo = risco de movimento climático/continuação (não fade).
- ATR comprimindo = energia acumulada (contexto), não direção.

## Fibonacci (agente FIB) — zona estrutural
- Swings CONFIRMADOS causalmente (pivot ±3, confirmação em i+3) — nunca escolher swing olhando o resultado.
- Zonas 38.2 / 50 / 61.8 do leg, tolerância = 0.5×ATR (zona, não pixel). 23.6 apenas contexto.
- Reação na zona (rejeição/retomada) = confluência; zona rompida = invalida o leg.

## Consenso (agente consenso) — síntese profissional (sem votação)
- RSI abre a oportunidade (70/30). O consenso exige **evidência coerente**:
  1. RSI com qualidade (divergência OU failure swing OU crossback) e lado coerente com a linha 50.
  2. Bollinger: rejeição/reentrada a favor, **sem walk/continuação contra**.
  3. ADX: tendência antiga NÃO fortalecendo; reação do DI oposto (ou range).
  4. ATR: mercado vivo; sem clima de continuação.
  5. FIB: preço em zona com reação (confluência estrutural).
- Falta de coerência ou contradição → WAIT. O consenso nunca força frequência.
- evidenceStrength é medida descritiva interna — NUNCA probabilidade de vitória.
