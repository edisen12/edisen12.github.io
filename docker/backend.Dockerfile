# ==============================================================================
# Dockerfile Backend — Servidor Isolado VPS (Node.js 22 Alpine)
# HH Offshore · Infotec Brasil
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Preparação de Dependências
# ------------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# Copia manifestos de dependência da raiz e do subdiretório server
COPY package.json package-lock.json* ./
COPY server/package.json* ./server/

# Instala dependências de produção de forma reprodutível
RUN if [ -f "./server/package.json" ]; then \
      cd server && npm install --omit=dev; \
    elif [ -f "./package.json" ]; then \
      npm install --omit=dev; \
    fi

# ------------------------------------------------------------------------------
# Stage 2: Runtime Mínimo, Seguro e Não-Root
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Cria diretórios na estrutura esperada pelas importações relativas
RUN mkdir -p /app/src/domain /app/server

# Copia dependências resolvidas
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/node_modules* ./server/node_modules/

# Copia exclusivamente os contratos de tipo compartilhados do domínio
# Mantém a árvore relativa ../src/domain/types.ts acessível pelo server
COPY src/domain/types.ts /app/src/domain/types.ts

# Copia a implementação completa do servidor
COPY server /app/server

# Atribui propriedade dos arquivos ao usuário 'node' (princípio do menor privilégio)
RUN chown -R node:node /app

# Execução como usuário não-root
USER node

# Expõe exclusivamente a porta da API interna (não exposta externamente no host)
EXPOSE 3000

# Healthcheck interno validando status 200 OK no endpoint de saúde
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/v1/health || exit 1

# Diretório de trabalho do servidor
WORKDIR /app/server

# Execução nativa de TypeScript usando stripping de tipos nativo do Node 22
CMD ["node", "--experimental-strip-types", "src/index.ts"]
