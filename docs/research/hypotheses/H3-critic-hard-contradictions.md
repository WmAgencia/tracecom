# H3 — Contradições duras do Critic deveriam bloquear/abster (CONTEST não basta)

- **status:** HYPOTHESIS (não testada; NÃO alterar prompts/regras do Critic)
- **origem:** `docs/research/5-trade-forensic-audit.md` (Task 4/8)
- **evidência observada (FACT):** EURAUD perdeu com `aceleracao_contra_a_entrada` **detectada no T0** pelo Critic; mesmo assim o Consensus aprovou (`criticVerdict=CONFIRM` com contradição) e o gate principal executou. Na janela, o Critic vetou 37 candidatos e contestou 74 (de 140 revalidações falhas) — ele é discriminativo, mas `CONTEST` não impede ordem. O braço shadow D só considera 2 códigos e absteve em 708/1.120.
- **mecanismo proposto:** certas contradições (aceleração contra, preço esticado contra, conflito de DI) carregam informação sobre a probabilidade de reversão imediata; permitir execução apesar delas aumenta perdas “evitáveis”.
- **trades afetados:** #4 EURAUD (aceleração contra); #3 CADCHF e #5 GBPNZD (`preco_esticado_contra_a_entrada` no snapshot ACK).
- **counterexample:** o WIN AUDCHF não teve contradições; porém candidatos contestados podem vencer (não medido — os AGENTS/CONTEST não são persistidos). Qualquer veto mais agressivo reduzirá cobertura.
- **como testar:** sombra offline do braço D estendido (todas as contradições duras) sobre os 1.120 `SHADOW_ARMS` + settlements prospectivos; medir WR, PnL normalizado, cobertura e perdas evitadas. Sem tocar no Critic de produção.
- **risco de overfit:** ALTO — o exemplo #4 é N=1; endurecer veto com base nele é exatamente “explicar os 4 LOSS”.
- **dados adicionais:** persistir contradições completas do Critic por avaliação (hoje só o executado guarda; `AGENTS` só grava CONFIRM).
