---
title: Matriz de Cobertura do Conhecimento
topic: cobertura por categoria e lacunas
category: COVERAGE
sourceIds: [SRC-CMT-001, SRC-CFA-001, SRC-BIS-001, SRC-CFTC-001]
sourceTier: MULTIPLE
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.85
status: SOURCE_KNOWLEDGE
tracecomApplicability: RESEARCH_ONLY
regimes: [TREND_UP, TREND_DOWN, RANGE, COMPRESSION, EXPANSION, TRANSITION, CHAOTIC]
setups: [TREND_PULLBACK, BREAKOUT_CONTINUATION, BREAKOUT_RETEST, FAILED_BREAKOUT, RANGE_REVERSAL, MOMENTUM_CONTINUATION, REJECTION, COMPRESSION_EXPANSION, REVERSAL_ATTEMPT]
indicators: [RSI14, ADX14, ATR14, DI_SPREAD, DONCHIAN]
markets: [EURUSD, GBPUSD, USDJPY, USDCAD]
timeframes: [M1, M5]
tags: [cobertura, lacunas, auditoria, matriz]
---

# Matriz de Cobertura do Conhecimento

## Tabela de Cobertura
| Categoria | Notas | SourceIds | tracecomApplicability | Lacunas |
|-----------|-------|-----------|------------------------|---------|
| CORE_BRAIN | 2 | SRC-CMT-001, SRC-CFA-001, SRC-BOOK-THARP-001, SRC-BOOK-DOUGLAS-001, SRC-BOOK-MURPHY-001, SRC-BOOK-SCHWAGER-001 | ADAPTATION_REQUIRED | Sem calibracao numerica especifica para binarias de 1 minuto |
| REGIME | 7 | SRC-CMT-001, SRC-BOOK-MURPHY-001, SRC-BOOK-WILDER-001, SRC-CFA-001 | ADAPTATION_REQUIRED | Sem classificador de regime validado; CHAOTIC e RESEARCH_ONLY |
| SETUP | 9 | SRC-CMT-001, SRC-BOOK-MURPHY-001, SRC-BOOK-WILDER-001, SRC-BOOK-SCHWAGER-001 | ADAPTATION_REQUIRED | Sem backtest proprio; sem mapeamento de expiracao fixo |
| INDICATOR | 5 | SRC-BOOK-WILDER-001, SRC-CMT-001, SRC-BOOK-SCHWAGER-001 | DIRECT | Features ja implementadas no motor deterministico |
| RISK | 3 | SRC-BOOK-THARP-001, SRC-CFA-001, SRC-BOOK-DOUGLAS-001, SRC-CMT-001 | ADAPTATION_REQUIRED | Sem dados reais de payout, slippage e latencia |
| MICROSTRUCTURE | 2 | SRC-CME-001, SRC-CFTC-001, SRC-CMT-001, SRC-BIS-001, SRC-ECB-001 | DIRECT | Sem book de ofertas e sem dados de tick |
| MACRO | 4 | SRC-FED-001, SRC-ECB-001, SRC-BOE-001, SRC-BOJ-001, SRC-BIS-001, SRC-CFTC-001 | RESEARCH_ONLY | Sem calendario economico nem feed de noticias em tempo real |
| PLAYBOOK | 2 | SRC-BIS-001, SRC-CFTC-001, SRC-CME-001, SRC-BOOK-DOUGLAS-001, SRC-BOOK-THARP-001, SRC-CMT-001 | ADAPTATION_REQUIRED | Comportamento OTC varia por plataforma e nao e auditavel |
| DISCIPLINE | 1 | SRC-BOOK-DOUGLAS-001, SRC-BOOK-THARP-001, SRC-CFA-001 | ADAPTATION_REQUIRED | Sem diario de decisao historico integrado |
| BOOK_METADATA | 1 | SRC-BOOK-WILDER-001, SRC-BOOK-MURPHY-001, SRC-BOOK-SCHWAGER-001, SRC-BOOK-THARP-001, SRC-BOOK-DOUGLAS-001 | RESEARCH_ONLY | Somente metadados; sem texto integral |
| COVERAGE | 1 | SRC-CMT-001, SRC-CFA-001, SRC-BIS-001, SRC-CFTC-001 | RESEARCH_ONLY | Matriz estatica; requer revisao manual |
| SOURCE_REGISTRY | 1 | SRC-FED-001, SRC-ECB-001, SRC-BOE-001, SRC-BOJ-001, SRC-CME-001, SRC-CFTC-001, SRC-BIS-001, SRC-CMT-001, SRC-CFA-001, SRC-BOOK-WILDER-001, SRC-BOOK-MURPHY-001, SRC-BOOK-SCHWAGER-001, SRC-BOOK-THARP-001, SRC-BOOK-DOUGLAS-001 | RESEARCH_ONLY | Fontes oficiais mudam; IDs sem URL dinamica |

## Lacunas Globais
- Ausencia de dados de livro de ofertas (order book) e de fluxo de ordens.
- Ausencia de dados de tick e de microestrutura intra-candle.
- Sem ingestao de calendario economico e noticias em tempo real.
- Sem validacao empirica propria das notas nesta base.
- Comportamento de precos OTC nao e auditavel por bolsa central.

## Limitacoes
- Contagens referem-se ao estado atual do diretorio de conhecimento.
- Applicability por categoria e indicativa; notas individuais prevalecem.
- Matriz deve ser atualizada quando novas notas forem adicionadas.
