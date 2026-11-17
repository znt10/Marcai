# O site da VPS (www.usemarcai.online): a landing + o formulário de
# interesse. Montado pelo `docker-compose.prod.yml` do Marcai-back, direto
# deste repositório (com `submodules=false`, porque os submódulos são
# privados).
FROM node:22-alpine
WORKDIR /app
COPY servidor.mjs ./
COPY index.html marca.png logo.svg ./publico/
COPY landing ./publico/landing
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/saude || exit 1
CMD ["node", "servidor.mjs"]
