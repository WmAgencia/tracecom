# Deploy da TRACECON

A Tracecon tem três destinos de deploy, cada um com um papel claro:

| Serviço | Papel | Estado |
|---------|-------|--------|
| **GitHub** | Código-fonte (público) | ✅ `WmAgencia/tracecom` |
| **Vercel** | SPA + API serverless (estático/leve) | ✅ funcionando (limitação: Binance bloqueia IP da Vercel) |
| **Railway** | Backend principal (WebSocket, cold store, aprendizado) | ⏳ criar projeto no painel |
| **Supabase** | Postgres gerenciado (adapter futuro) | ⏳ disponível |

---

## GitHub (✅ feito)

Repo público: **https://github.com/WmAgencia/tracecom** — branch `main`.
`vercel.json`, `railway.json`, `api/http.ts`, `Dockerfile` e `README` incluídos.

> Observação: o endereço que você citou (`consecomtracecom-oss`) não foi acessível
> pelas contas autenticadas. O repo foi criado em `WmAgencia/tracecom`. Para mover
> para a org, basta transferir o owner no GitHub ou me dar acesso à org.

---

## Vercel (✅ deploy feito)

- Produto: **https://tracecom-orcin.vercel.app**
- `vercel.json` já configurado (build `npm run build`, output `dist`).
- A função serverless (`api/http.ts`) é **autocontida** (sem `node:sqlite`/`
  import.meta.url`), expõe `/health`, `/api/status`, `/api/market/context`,
  `/api/analyze`, `/api/news`, `/api/catalog`.

⚠️ **Importante (limitação real):** o IP dos datacenters da Vercel é **bloqueado
pela Binance (HTTP 451)**. Por isso `/api/market/*` e `/api/analyze` retornam
`available:false` na Vercel. Isso é uma restrição de IP da infraestrutura, não
do código. Para dados reais de mercado, o ideal é o **Railway** (ou adicionar um
proxy/provedor alternativo).

---

## Railway (⏳ criar projeto — 2 cliques no painel)

A CLI Railway não permite criar projetos de forma headless (apenas linka a
existentes). Para ativar:

1. No painel **https://railway.app** → **New Project** → **Deploy from GitHub repo**
   → escolha `WmAgencia/tracecom`.
2. O repo já tem `railway.json` (build `npm run build`, start `node dist/cli/serve.js`,
   healthcheck `/health`) e `Dockerfile` (alternativa: com o `railway.json` o
   Nixpacks cuida do build).
3. Defina as variáveis no painel (Serviço → Variables):
   ```
   MARKET_DATA_MODE=binance
   HTTP_PORT=8788
   GROQ_API_KEY=<sua chave>   # opcional (IA)
   TRACECON_API_TOKEN=<token> # opcional (proteger /api/*)
   DATABASE_PATH=tracecon.db  # ou /data/tracecon.db (volume persistente)
   ```
4. Railway injeta `PORT` — garanta que o serviço usa a variável `PORT` da
   Railway (o `serve.js` lê `HTTP_PORT`; se `PORT` não estiver setado, defina
   `HTTP_PORT` para o mesmo valor, ou use `PORT` como fonte). Recomendado: criar
   um **Volume** montado em `/data` e usar `DATABASE_PATH=/data/tracecon.db`
   para cold store persistente.
5. Deploy → acesse a URL de domínio gerada.

> A Binance REST pública **não bloqueia o Railway** normalmente → dados reais de
> mercado funcionam. WebSocket e cold store persistem.

---

## Supabase (Postgres)

A Tracecon usa **SQLite local** nesta fase. O Supabase entra como **Postgres
gerenciado** quando migrarmos a persistência (multi-tenancy, billing, RLS).

- Crie um projeto Supabase (ou reutilize o que você tem).
- As credenciais (URL, anon key, service role) ficam **só no servidor** —
  nunca no `.env` versionado nem no cliente.
- O código já está preparado: repositórios com interface (`AnalysisRepository`,
  `CandleRepository`, `DecisionRepository`) → basta um adapter Postgres.

---

## Onde estão os segredos

Nenhuma credencial real está no git (verificado). Variáveis são injetadas via
painel dos serviços. `.env` é ignorado (`.gitignore`).

---

## Resumo rápido

- **Ver agora (UI + API leve):** https://tracecom-orcin.vercel.app
- **Dados reais + backend completo:** ative o **Railway** (passo acima).
- **Fonte:** https://github.com/WmAgencia/tracecom
