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
