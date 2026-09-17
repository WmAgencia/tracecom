---
title: Comportamento de Sessao em OTC
topic: sessoes, liquidez e precos OTC
category: PLAYBOOK
sourceIds: [SRC-BIS-001, SRC-CFTC-001, SRC-CME-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.75
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [COMPRESSION, EXPANSION, RANGE, CHAOTIC]
setups: [BREAKOUT_CONTINUATION, FAILED_BREAKOUT, COMPRESSION_EXPANSION]
indicators: [ATR14, ADX14, DONCHIAN]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [otc, sessao, liquidez, horario]
---

# Comportamento de Sessao em OTC

## Contexto de Mercado
- O mercado de moedas e descentralizado (OTC); nao existe bolsa central de FX a vista.
- No varejo de opcoes binarias, o preco e fornecido pela plataforma, derivado de referencias de mercado.
- O levantamento trienal do BIS mede o volume global de FX e documenta a estrutura do mercado.

## Sessoes Principais
- Toquio: inicio da manha asiatica, liquidez moderada; pares com JPY mais ativos.
- Londres: maior volume global; movimentos tendem a ser mais fluidos.
- Nova York: sobreposicao com Londres concentra a maior liquidez do dia.
- Fora das sessoes: spreads e ruido tendem a aumentar; compressao artificial e comum.

## Riscos de Janela
- Aberturas de sessao podem gerar spikes com falha imediata de rompimento.
- Finais de semana e feriados reduzem liquidez; preco OTC pode divergir do mercado interbancario.
- Divulgacoes macro concentram volatilidade em horarios conhecidos.

## Diretrizes
- Preferir janelas com liquidez comprovada para validar rompimentos e retestes.
- Em janelas finas, exigir confirmacao adicional ou aplicar WAIT_DISCIPLINE.
- Registrar o horario das decisoes para auditoria por sessao.

## Limitacoes
- Nao ha dados de volume por sessao no ambiente OTC do motor.
- Horarios de verao/inverno (DST) alteram janelas e exigem ajuste de calendario.
- O preco OTC nao e um preco oficial de bolsa; nao ha referencia central auditavel.
