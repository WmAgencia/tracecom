# H4 — Quality Gate: 15 pontos permanentemente inativos (accel/velocity/knowledge)

- **status:** FACT (defeito de implementação documentado; **não corrigido** por regra: não alterar Quality Gate/thresholds)
- **origem:** `docs/research/5-trade-forensic-audit.md` §5.2 e §6
- **evidência observada:** `relay/trade-quality.mjs` (`featuresFromSnapshot`) lê `structure.velocity.velocity/acceleration`, mas o Trader guarda velocidade/aceleração em `momentum` (`professional-brain.mjs` `buildOutput`) e `knowledgeContextIds` nunca é copiado para as features. Resultado: `accel_agrees` (8), `velocity_agrees` (4) e `knowledge_used` (3) **não pontuam nunca**; teto efetivo = 95; AUDCHF (WIN) marcou exatamente 95 com todos os demais checks ok; 0/1.120 SHADOW_ARMS pontuaram nesses itens.
- **mecanismo proposto:** erro de path de campo + campo ausente no mapeamento de features. A rubrica tem máx. soma 110 (clampeada em 100); o filtro ficou ~15 pontos mais restritivo que o projetado.
- **trades afetados:** todos (efeito constante); no caso das 5 operações, os scores 75–95 continuariam acima do limiar se corrigidos (mas candidatos hoje rejeitados poderiam passar → mudaria a seleção).
- **counterexample:** nenhum entre os 5; a prova é o próprio código + 1.120 amostras.
- **como testar:** teste de caracterização já criado (`tests/research/forensic-5-trade-audit.test.ts`) afirmando que os 3 checks nunca passam com snapshot do runtime. Para corrigir: proposta offline separada, com recálculo da distribuição e do threshold **sem** aplicação em produção até Promotion Gate.
- **risco de overfit:** BAIXO para o diagnóstico; ALTO para “corrigir e soltar” (muda a seleção de trades).
- **dados adicionais:** snapshot T0 do candidato persistido para reproduzir o score de produção (D4).
