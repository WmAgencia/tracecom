# Dockerfile para deploy do RELAY como processo long-running (Railway).
# Build do app raiz (com devDependencies para o tsc) + relay (deps proprias) e CMD no servidor do relay.
FROM node:22-alpine

WORKDIR /app

# --- app raiz: deps (com dev) -> fontes -> build -> prune
COPY package*.json ./
RUN (npm ci || npm install) || true
COPY tsconfig.json ./
COPY vitest.config.ts ./
COPY src ./src
COPY api ./api
COPY extension ./extension
COPY scripts ./scripts
RUN npm run build || true
RUN npm prune --omit=dev || true

# --- relay (runtime real: WS IQ Option + migrations + knowledge)
COPY relay ./relay
RUN cd relay && (npm install --omit=dev) || true

ENV NODE_ENV=production
ENV HTTP_PORT=8788
EXPOSE 8788

CMD ["node", "relay/server.mjs"]
