# H5 — Braço shadow `C_STABILITY` é degenerado (não usar como evidência)

- **status:** FACT (defeito de instrumentação shadow; **não corrigido**)
- **origem:** `docs/research/5-trade-forensic-audit.md` §5.3
- **evidência observada:** `evaluateShadowArms` usa `unstable = directionChanges >= 2 || candidateChangedBeforeEntry`; `directionChanges` só pode ser 0/1 (ação inicial × final) e `candidateChangedBeforeEntry` é true se **qualquer** campo mudou (inclusive preço). Resultado: **1.016/1.120 (90,7%) abstenções** por `DIRECTION_UNSTABLE`; `F_COMBINED` aceita 1/1.120. Os 4 trades executados tiveram `candidateChangedBeforeEntry=true` (incluindo o WIN).
- **mecanismo proposto:** definição de estabilidade ampla demais + contador de flip inviável.
- **trades afetados:** pesquisa shadow (todos os candidatos); nenhum efeito em execução.
- **counterexample:** os 104 aceites de C ocorrem quando literalmente nada mudou entre criação e finalização — caso raro e pouco informativo.
- **como testar:** offline, redefinir estabilidade como mudanças de **ação/estrutura/regime** (não preço) e contar flips reais no ring de avaliações; comparar com settlement em SHADOW prospectivo.
- **risco de overfit:** BAIXO no diagnóstico; qualquer nova definição deve ser congelada antes do prospectivo.
- **dados adicionais:** histórico de avaliações por candidato (hoje amostrado esparsamente no audit trail).
