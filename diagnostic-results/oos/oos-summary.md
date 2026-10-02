### UK 100 · 1m · RSI14 · h5

- MODEL_VERSION: `db7f45fccadbe144ac5fc157`
- Horizonte operacional: **300s** ✓ compatível com V3 (300s)
- TRAIN_WR: **75.0%** (n=36)
- VALIDATION_WR: **50.0%** (n=8)
- BLIND_OOS_WR: **50.0%** (n=20, IC95 Wilson [33.2, 66.8])
- PROSPECTIVE_WR: _aguardando amostra prospectiva_ 
- RAW_SIGNALS: 64 · INDEPENDENT_EVENTS (teste): 10 · WR independente: 60.0%
- Payout observado: 91% (produto de execução: blitz-options) · breakeven WR: 52.4%
- EV por 100 stakes (teste, payout 91%): **-4.5**
- Sensibilidade de payout: 80%→EV -10 · 85%→EV -7.5 · 89%→EV -5.5 · 91%→EV -4.5
- DRAWDOWN_PAPER (teste): 6.36 stake(s) · final -0.9
- Dados: 1052 barras únicas de 4000 linhas (2948 duplicatas descartadas) · span 69.52h · gaps 1 (52h)
- Sinais eliminados por gap: features 25 · settlement 5
- Disponibilidade: asset_id 1475, aberto=true, produtos=binary-options/blitz-options/turbo-options
- **VEREDITO: AMOSTRA_INSUFICIENTE** — apenas 20 sinais no teste cego
- Dias distintos no teste cego: 1 (teto da informação independente) · melhor baseline: always_down 52.0%

### US 2000 · 1m · RSI14 · h5

- MODEL_VERSION: `082d6c42727c828d1b333d18`
- Horizonte operacional: **300s** ✓ compatível com V3 (300s)
- TRAIN_WR: **67.6%** (n=37)
- VALIDATION_WR: **100.0%** (n=2)
- BLIND_OOS_WR: **70.0%** (n=10, IC95 Wilson [46.6, 82.3])
- PROSPECTIVE_WR: _aguardando amostra prospectiva_ 
- RAW_SIGNALS: 49 · INDEPENDENT_EVENTS (teste): 4 · WR independente: 100.0%
- Payout observado: 91% (produto de execução: blitz-options) · breakeven WR: 52.4%
- EV por 100 stakes (teste, payout 91%): **33.7**
- Sensibilidade de payout: 80%→EV 26 · 85%→EV 29.5 · 89%→EV 32.3 · 91%→EV 33.7
- DRAWDOWN_PAPER (teste): 3 stake(s) · final 3.37
- Dados: 1052 barras únicas de 5000 linhas (3948 duplicatas descartadas) · span 17.52h · gaps 0 (0h)
- Sinais eliminados por gap: features 0 · settlement 0
- Disponibilidade: asset_id 1473, aberto=true, produtos=binary-options/blitz-options/turbo-options
- **VEREDITO: AMOSTRA_INSUFICIENTE** — apenas 10 sinais no teste cego
- Dias distintos no teste cego: 1 (teto da informação independente) · melhor baseline: always_down 52.8%

### S&P 500 ETF (SPY) · 1m · fade3 · h5 [INSTRUMENTO INDISPONÍVEL]

- MODEL_VERSION: `8d9c9f6f1b7c898a5b75d448`
- Horizonte operacional: **300s** ✓ compatível com V3 (300s)
- TRAIN_WR: **65.3%** (n=124)
- VALIDATION_WR: **61.3%** (n=75)
- BLIND_OOS_WR: **61.8%** (n=55, IC95 Wilson [49.4, 72.7])
- PROSPECTIVE_WR: _aguardando amostra prospectiva_ 
- RAW_SIGNALS: 254 · INDEPENDENT_EVENTS (teste): 29 · WR independente: 65.5%
- Payout observado: **desconhecido** (catálogo indisponível) — EV reportado como sensibilidade, sem assumir 91% · breakeven WR: 55.6%
- EV por 100 stakes (teste, payout 80%): **11.3**
- Sensibilidade de payout: 80%→EV 11.3 · 85%→EV 14.4 · 89%→EV 16.8 · 91%→EV 18.1
- DRAWDOWN_PAPER (teste): 10.6 stake(s) · final 6.2
- Dados: 1078 barras únicas de 7000 linhas (5922 duplicatas descartadas) · span 118.45h · gaps 3 (100.5h)
- Sinais eliminados por gap: features 75 · settlement 15
- Disponibilidade: não localizado no catálogo
- **VEREDITO: POUCOS_DIAS_INDEPENDENTES** — o teste cego abrange 2 dia(s) — operações no mesmo dia são correlacionadas
- Dias distintos no teste cego: 2 (teto da informação independente) · melhor baseline: simple_reversion 52.6%

### US 500 · 1m · fade3 · h5 [SUBSTITUTO DECLARADO]

- MODEL_VERSION: `4349fb03c90ac672ce1ed6f5`
- Horizonte operacional: **300s** ✓ compatível com V3 (300s)
- TRAIN_WR: **58.5%** (n=106)
- VALIDATION_WR: **52.5%** (n=59)
- BLIND_OOS_WR: **53.7%** (n=54, IC95 Wilson [41.5, 65.5])
- PROSPECTIVE_WR: _aguardando amostra prospectiva_ 
- RAW_SIGNALS: 219 · INDEPENDENT_EVENTS (teste): 23 · WR independente: 52.2%
- Payout observado: 91% (produto de execução: blitz-options) · breakeven WR: 52.4%
- EV por 100 stakes (teste, payout 91%): **2.6**
- Sensibilidade de payout: 80%→EV -3.3 · 85%→EV -0.6 · 89%→EV 1.5 · 91%→EV 2.6
- DRAWDOWN_PAPER (teste): 9.36 stake(s) · final 1.39
- Dados: 1051 barras únicas de 5000 linhas (3949 duplicatas descartadas) · span 17.5h · gaps 0 (0h)
- Sinais eliminados por gap: features 0 · settlement 0
- Disponibilidade: asset_id 1470, aberto=true, produtos=binary-options/blitz-options/turbo-options
- **VEREDITO: POUCOS_DIAS_INDEPENDENTES** — o teste cego abrange 1 dia(s) — operações no mesmo dia são correlacionadas
- Dias distintos no teste cego: 1 (teto da informação independente) · melhor baseline: no_indicator_model 54.6%
