# Imagem enxuta e compatível com o ambiente gerenciado do Google Cloud Run.
FROM node:22-alpine

LABEL org.opencontainers.image.title="Calculadora de Carbono AmazonBioEco" \
      org.opencontainers.image.description="PWA estática para estimativa educativa de redução de carbono" \
      org.opencontainers.image.source="GitHub"

ENV NODE_ENV=production \
    PORT=8080 \
    PUBLIC_DIR=/app/public

WORKDIR /app

# Copia somente o servidor e os arquivos públicos necessários em produção.
COPY --chown=node:node server.mjs ./server.mjs
COPY --chown=node:node public ./public

# Executa sem privilégios administrativos.
USER node

EXPOSE 8080
STOPSIGNAL SIGTERM

CMD ["node", "server.mjs"]
