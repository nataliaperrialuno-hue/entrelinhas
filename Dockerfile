# =============================================================================
# Entrelinhas — imagem de produção (multi-stage)
#
# A imagem final não contém .env nem segredos: TOKEN_HMAC_SECRET é injetado pelo
# Compose em tempo de execução. O backend é iniciado com `tsx`, que é uma
# dependência de desenvolvimento — por isso o `npm ci` completo no stage de deps.
# =============================================================================

# --- 1) Dependências: instala os workspaces com devDependencies ---------------
FROM node:24-alpine AS deps
WORKDIR /app

# Apenas os manifestos nesta camada: alterações no código não invalidam o cache.
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/

# O npm ci pode hoistar tudo para a raiz; garantir os diretórios aninhados evita
# falha nos COPY seguintes quando não houver conflito de versões entre workspaces.
RUN npm ci && mkdir -p frontend/node_modules backend/node_modules

# --- 2) Build: gera o bundle do frontend e checa os tipos do backend ---------
FROM node:24-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules
COPY --from=deps /app/backend/node_modules ./backend/node_modules

# O restante do código entra conforme as exclusões de .dockerignore.
COPY . .

# `npm run build --workspaces` executa `tsc --noEmit && vite build` no frontend e
# `tsc --noEmit` no backend; o artefato usado em produção é frontend/dist.
RUN npm run build

# --- 3) Runtime: somente o necessário para `npm start -w @entrelinhas/backend` -
FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=3001
WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/

# tsx e as dependências de produção vêm do stage de deps (npm ci completo).
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules
COPY --from=deps /app/backend/node_modules ./backend/node_modules

# Bundle estático servido pelo Express quando NODE_ENV=production.
COPY --from=build /app/frontend/dist ./frontend/dist

# Fonte do backend executada via tsx; o tsconfig é lido pelo próprio tsx.
COPY backend/src ./backend/src
COPY backend/tsconfig.json ./backend/tsconfig.json

# O servidor resolve o banco em /app/backend/data (raiz do backend).
RUN mkdir -p /app/backend/data && chown -R node:node /app/backend/data

USER node

EXPOSE 3001

VOLUME ["/app/backend/data"]

# Healthcheck usa apenas o Node embutido (sem wget/curl na imagem alpine).
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["npm", "start", "-w", "@entrelinhas/backend"]
