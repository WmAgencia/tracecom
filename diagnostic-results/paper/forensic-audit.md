# Forensic audit — USD/CAD paper replay

Independent settlement uses only dataset rows matching each trade timestamp and expiry timestamp, comparing close-to-close. No production code or strategy was modified.

- Trades audited: 1000; sample exported: first 100
- Entry/expiry matches: 1000/1000, 1000/1000
- Recorded vs independent agreement: 45.10%
- Independent outcomes: {"LOSS":465,"WIN":452,"DRAW":83}
- Confusion: {"LOSS->LOSS":447,"LOSS->WIN":448,"WIN->WIN":4,"LOSS->DRAW":82,"WIN->LOSS":18,"WIN->DRAW":1}
- Inverted direction WR: 50.71%
- Always BUY WR: 48.64%; always SELL WR: 51.36%
- Random 50% baseline expectation: 458.5 wins / 917 evaluated
- Movement: min -1.3805299997329712, max 0.0006999969482421875, mean -0.0027612907886505125, positive 446, negative 471, flat 83
- Temporal: monotonic=true; 7 gaps in source (preserved, not imputed)

Interpretation: the independent audit is a consistency check, not evidence of predictive validity. Recorded outcomes that disagree with close-to-close settlement require investigation before any promotion.
