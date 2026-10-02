# Consecom Bot — OTC Bot para IQ Option

Bot de operações binárias OTC na IQ Option com venda por cotação real.

---

## Como usar

### 1. Execute o bot

Dê **dois cliques** no arquivo `Iniciar Bot.bat`.

O terminal vai abrir e perguntar suas informações na primeira vez:

```
  E-mail da IQ Option: seu@email.com
  Senha da IQ Option: sua senha
```

Depois de configurar, o bot inicia automaticamente.

### 2. Próximas execuções

Execute novamente `Iniciar Bot.bat`. Vai aparecer um menu rápido:

```
  1 — RODAR AGORA (mesma conta)
  2 — TROCAR DE CONTA (demo ↔ real)
  3 — ATUALIZAR CONFIGURAÇÕES (stake, meta, etc.)
  4 — FAZER LOGIN COM OUTRA CONTA
  5 — SAIR
```

---

## O que o bot faz

- Opera em **todos os ativos OTC** disponíveis 24/7
- Até **2 posições simultâneas** no mesmo ativo quando o gráfico está muito favorável
- **Martingale** após loss (mesma direção, sem inverter)
- **Venda automática** só por cotação real — nunca por adivinhação
- Para sozinho quando atingir a meta de lucro

---

## Configurações disponíveis

| Pergunta | Exemplo |
|---|---|
| E-mail da IQ Option | `seu@email.com` |
| Senha da IQ Option | `sua senha` |
| Conta | DEMO ou REAL |
| Stake base | `2.00` (valor fixo por operação) |
| Exposição máxima | `50` (% do saldo simultâneo — padrão: 50%) |
| Meta de lucro | `30` (para ao atingir R$ 30,00 de lucro) |

> **Exposição máxima:** se começou com R$ 60,00 e definiu 50%, o bot nunca terá mais de R$ 30,00 em operações abertas ao mesmo tempo.

---

## Painel em tempo real

```
[⏱00:40] [🕯️ 142] [📊 8 ops | ✅ 5 | ❌ 3 | WR 62.5%] [💰 +R$12.40] [⏳ R$6.00]
```

| Ícone | Significado |
|---|---|
| `⏱` | Tempo de sessão |
| `🕯️` | Candles 5s fechados |
| `📊` | Total de operações fechadas |
| `✅ / ❌` | Acertos / Erros |
| `WR` | Win rate |
| `💰` | Lucro/prejuízo da sessão |
| `⏳` | Valor em aberto nas posições |

---

## Parar o bot

| Como | Quando usar |
|---|---|
| **Tecla `K`** | Caminho primário |
| **Ctrl + C** | Funciona no terminal |

O bot SEMPRE imprime o relatório final ao parar.

---

## Arquivos gerados

Os dados ficam na pasta **principal do Tracecom Project** (onde está o arquivo original do bot):

| Arquivo | O que contém |
|---|---|
| `bot-credentials.json` | E-mail, senha, conta, stake |
| `bot-state-v15.json` | Estado interno do bot |
| `resultados-v15.json` | Histórico completo de todas as operações |

---

## Requisitos

- [Node.js 18+](https://nodejs.org/) instalado
- Windows

Verifique o Node:
```powershell
node --version
```

---

## Problemas comuns

**"Não conecta"** — verifique e-mail e senha. Rode novamente e escolha opção 4 para fazer login com outra conta.

**"Saldo indisponível"** — a conta DEMO pode ter acabado. Recarregue no app da IQ Option.

**"Meta batida mas o bot não parou"** — o bot para no próximo candle após bater a meta. Isso é normal.
