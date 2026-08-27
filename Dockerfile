# Dockerfile para deploy como processo long-running (Railway / qualquer PaaS).
# Usa Node 22+ (Node Alpine) e roda o servidor HTTP da TRACECON.
FROM node:22-alpine

WORKDIR /app

# Copia manifests e instala deps
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copia código-fonte e compila
COPY tsconfig.json ./
COPY vitest.config.ts ./
COPY src ./src
COPY api ./api
COPY extension ./extension
COPY scripts ./scripts
RUN npm run build

# Porta do servidor (Railway injeta PORT)
ENV NODE_ENV=production
ENV HTTP_PORT=8788
EXPOSE 8788

CMD ["node", "dist/cli/serve.js"]
