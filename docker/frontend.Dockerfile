# ==============================================================================
# Dockerfile Frontend — Topologia self-hosted (Nginx Hardened)
# HH Offshore · Infotec Brasil
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Compilação da SPA React com Travas de Segurança da Topologia
# ------------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# Instalação limpa e reprodutível das dependências
COPY package.json package-lock.json ./
RUN npm ci

# Código-fonte, configurações e assets públicos
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src

# Ativação estrita da Topologia self-hosted:
# Dispara as travas de compilação do Vite e a auditoria closeBundle()
# garantindo zero bytes de SDKs ou credenciais de BaaS no artefato final dist/
ENV VITE_TOPOLOGY=self-hosted
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Servidor Web Nginx 1.27 Alpine Hardened
# ------------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runner

# Remove configurações padrão do Nginx
RUN rm -rf /etc/nginx/conf.d/* /etc/nginx/nginx.conf

# Copia configuração corporativa hardened (headers, proxy reverso, SSE e cache)
COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf

# Copia os artefatos estáticos auditados gerados no Stage 1
COPY --from=builder /app/dist /usr/share/nginx/html

# Ajuste de permissões de leitura segura para usuário nginx
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

# Expõe portas HTTP (80) e HTTPS (443)
EXPOSE 80 443

# Healthcheck interno do Nginx
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1

# Inicialização em primeiro plano
CMD ["nginx", "-g", "daemon off;"]
