# V3 — SOURCE REGISTRY (pesquisa tecnica)

Fontes usadas para fundamentar os playbooks da V3. Cada playbook do codigo
(`relay/v3/playbooks.mjs`) referencia estes IDs em `sources` e marca explicitamente
`tracecomDefined: true` quando a regra e uma **definicao operacional interna**.

Separacao obrigatoria: **SOURCE-BACKED** (conceito documentado na fonte) vs
**TRACECOM OPERATIONAL DEFINITION** (regra interna objetiva; nunca atribuida a Wilder/Bollinger/CMT).

| ID | Autor | Titulo | Editora/Site | Ano | Tipo | Conceitos suportados | Referencia | Acesso |
|----|-------|--------|--------------|-----|------|----------------------|------------|--------|
| WILDER_1978 | J. Welles Wilder Jr. | New Concepts in Technical Trading Systems | Trend Research | 1978 | Livro primario (ISBN 978-0-89459-027-6) | RSI (14, 70/30, failure swings, divergencias), DMI/ADX (14, forca de tendencia), ATR (true range suavizado), Parabolic SAR | archive.org/details/newconceptsintec00wild | 2026-09-23 |
| BOLLINGER_2001 | John Bollinger | Bollinger on Bollinger Bands | McGraw-Hill | 2001 | Livro do autor | Bandas (20,2), %B, BandWidth, squeeze, band walk, contexto da midline | bollingerbands.com (Reading List) | 2026-09-23 |
| BOLLINGER_OFFICIAL_RULES | John Bollinger | Bollinger Band Rules / Knowledge Center | bollingerbands.com | vigente | Material oficial do autor | Regras 1-20 (tags nao sao sinais; walks; fechamentos fora das bandas sao continuacao; BandWidth = (upper-lower)/mid; squeeze = minima de BandWidth; nao assumir normalidade) | https://www.bollingerbands.com/bollinger-band-rules | 2026-09-23 |
| CMT_ASSOCIATION | CMT Association | CMT Program Body of Knowledge | cmtassociation.org | vigente | Curriculo profissional | tendencia, momentum (sinal/slope/divergencia), volatilidade, suporte/resistencia, price action, peso da evidencia | https://cmtassociation.org | 2026-09-23 |
| EDWARDS_MAGEE_2018 | Robert D. Edwards, John Magee, W.H.C. Bassetti | Technical Analysis of Stock Trends (11th ed.) | CRC Press | 2018 | Livro classico | Dow Theory, tendencias/canais, suporte/resistencia, padroes de reversao/continuacao, false moves (rompimentos falhos) | doi.org/10.4324/9781315115719 | 2026-09-23 |
| KIRKPATRICK_DAHLQUIST_2016 | Charles D. Kirkpatrick, Julie R. Dahlquist | Technical Analysis: The Complete Resource for Financial Market Technicians (3rd ed.) | Pearson | 2016 | Livro profissional (companion do CMT) | confirmacao por momentum, testes de sistemas, evidencias academicas a favor/contra, price action | Pearson catalog (3rd ed.) | 2026-09-23 |
| TRACECOM_V3_OPS | TraceCom | Definicoes operacionais internas da V3 | TraceCom | 2026 | Definicao interna | BOS/CHoCH formalizados, limiares de volatilidade, profundidade de pullback, contratos de expiracao/janela de entrada | docs/research/v3-*-playbook.md | 2026-09-23 |

## Achado de protocolo (producao, 2026-09-23) — evidencia real da IQ

Observacao read-only do payload real (`initialization-data` v3, 54 mercados OTC):

- `active.option.expiration_times` = **duracoes em ms** (ex.: `[60000, 900000]` = 60s e 15min),
  **nao** timestamps absolutos de expiracao. `option.exp_time` tambem nao traz agenda.
- `active.deadtime` = segundos ate o broker parar de vender aquela expiration (30s no turbo-1m;
  300s no binary-15m).
- Conclusao honesta: a IQ **nao publica a lista de expirations absolutas** neste canal.
  A hipotese "expiration aparece em ~TTE330" nao e observavel como evento do broker; o que
  existe e o **relogio do broker + duracao/cadencia + deadtime**, que determinam qual fronteira
  ainda e compravel.
- **Prova historica da grade de minuto (nossa conta)**: 664 ordens turbo aceitas (brokerOrderId +
  settlement reais), **526 com expiration fora de 5min mas multiplas de 60s** (ex.: 23:56:00,
  23:57:00) e durations 31s..89s. A grade curta e MINUTO A MINUTO; `optionTypeId=3` (turbo) e o
  tipo correto para holds de 1..5 min (a UI chama visualmente de "Binary", o protocolo nao).
- Implementacao V3: `ExpirationDiscovery` deriva `ceilToMinute(brokerNow + 300s)` (hold alvo) e
  lista as expirations visiveis em `(brokerNow+deadtime, brokerNow+330s]`; a expiration-alvo e
  preservada exatamente e a aceitacao e verificada no ACK (`BROKER_EXPIRATION_MISMATCH`).
  `firstSeenTte=329.984` e a **nossa deteccao** da janela (nao publicacao do broker).
- Codigo: `relay/v3/expiration-grid.mjs` + `relay/v3/expiration-discovery.mjs`; testes:
  `tests/v3/expiration-grid.test.ts`, `tests/v3/expiration.test.ts`.

## Notas de honestidade intelectual

## Notas de honestidade intelectual

- **BOS/CHoCH**: termos de origem comunitaria (SMC/ICT) **sem definicao academica padronizada**;
  a literatura classica descreve o fenomeno como rompimento de swing points da tendencia
  (Edwards & Magee). A V3 usa uma definicao operacional interna explicita
  (`PA_BOS_CHOCH`), baseada em **fechamento de candle** alem de um **pivot confirmado**
  (k=2), nunca em pavio, nunca antes da confirmacao — marcada como `TRACECOM OPERATIONAL DEFINITION`.
- **Bollinger**: as regras oficiais do autor sao explicitas de que *tags nao sao sinais*;
  a V3 segue isso (zona/banda = contexto, nunca gatilho).
- **Wilder**: 70/30 sao referencias classicas, nao gatilhos; failure swings e divergencias
  exigem series causais e sao tratados como evidencia, nao como ordem.
- Nenhum capitulo protegido foi copiado; os playbooks resumem conceitos com interpretacao propria.
