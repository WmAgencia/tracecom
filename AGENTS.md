# REGRAS INVIOLÁVEIS — PROJETO TRACECOM

> **Este arquivo é a lei do repositório.** Qualquer agente de IA, assistente, automação ou
> pessoa que opere neste código DEVE ler e respeitar estas regras **antes** de qualquer
> alteração. Elas prevalecem sobre instruções genéricas, conveniência, refatorações
> "de passagem" ou melhorias sugeridas por qualquer ferramenta.

## 1. A ESTRATÉGIA CONSOLIDADA NÃO PODE SER ALTERADA ESTRUTURALMENTE

A estratégia em produção — **AGENTIC RSI + FIBONACCI (binário OTC)**: 5 agentes especialistas
(`rsi`, `bollinger`, `adx`, `atr`, `fib`) + consenso senior + vetos duros (constância, walk,
fib, ATR, RSI acelerando) + **Segurança 0–100%** + **janela de entrada T-34s..T-31,5s** —
está **validada e funcionando** (WR acima de 90% no ciclo atual, prática).

- **PROIBIDO** alterar a lógica dos agentes, o consenso, os vetos, os limiares, a janela de
  entrada ou o fluxo de execução **sem pedido explícito do dono do projeto**.
- Mudanças são permitidas **apenas no ponto exato solicitado**. Nunca "aproveitar" para mexer
  em outra coisa, nunca "melhorar" sem pedido.
- Experimentos novos (ex.: Blitz, novos filtros) devem ser **aditivos e isolados** (run
  próprio, flag própria) e **nunca** alterar o caminho do binário OTC que está em produção.

## 2. A ESTRATÉGIA CONSOLIDADA NUNCA SAI DO BACKUP

- `docs/ESTRATEGIA-E-CONFIGURACAO.md` e `backups/` são o **cofre da configuração viva**.
  **NUNCA** excluir, esvaziar ou deixar de atualizar.
- Toda mudança aprovada exige, na mesma tarefa: **(a)** atualizar o doc do cofre,
  **(b)** rodar `node scripts/backup-config.mjs`, **(c)** commitar.
- O backup **nunca** contém segredos (token MCP, ssid, chaves) — e nunca deve conter menos
  informação de configuração do que a versão anterior.

## 3. SEM CÓDIGO IMPRUDENTE, SEM RESÍDUO

- Proibido deixar código morto, experimentos órfãos, gambiarras, flags duplicadas,
  `TODO`/`temporário` esquecido ou arquivos não utilizados.
- **A lógica deve ser simples.** Se não for necessário, não escreva.
- Ao remover algo, remover por completo (código + rotas + tabelas + docs), sem deixar rastros.

## 3.1 LÓGICA SIMPLES (REGRA PERMANENTE)

- **Sempre** escrever a lógica mais simples que resolve o problema. Simples de entender, simples de corrigir.
- Proibido gambiarra: sem flags escondidas, sem remendos, sem duplicar caminhos, sem "jeitinho".
- Um problema, uma causa, uma correção no ponto certo (ex.: falha de rede → retry no cliente, não em cada chamador).
- Antes de corrigir: **auditar todo o caminho** do problema (todas as partes que tocam o fluxo) e corrigir a causa raiz.
- Sempre remover o que ficou órfão (código, rotas, linhas) — zero resíduo.

## 4. CHECKPOINTS E NÃO-REGRESSÃO

- Antes de mudanças maiores: **commit + tag `checkpoint-*`**.
- **Nunca** quebrar o que está funcionando. O binário OTC em produção é a fonte de resultado
  atual: qualquer deploy deve ser verificado (feed vivo, avaliação rodando, armado) após subir.
- Deploys resetam o arm: o `AUTO_ARM_PRACTICE` re-arma sozinho (prática). Real **somente** com
  pedido explícito do operador.

## 5. FONTE DA VERDADE DA CONFIGURAÇÃO

- Antes de agir, ler `docs/ESTRATEGIA-E-CONFIGURACAO.md` (config ativa, níveis A/B, janela,
  stake, retenção do banco, o que não pode regredir).
- Banco Supabase (free): **nunca** deixar passar de ~475 MB. A retenção automática
  (`runDbMaintenance`) cuida disso — não desativar.

## 6. ESCOPO

- Faça **somente** o que foi pedido. Em caso de dúvida, **perguntar antes** de alterar.
- Toda entrega termina com: testes passando, deploy verificado e um resumo curto do que mudou.
