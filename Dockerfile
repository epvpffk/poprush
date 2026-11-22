FROM node:24-bookworm-slim
WORKDIR /app
COPY public/ ./public/
COPY migrations/ ./migrations/
COPY *.mjs ./
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/colorpop.sqlite TRUST_PROXY=true
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "server.mjs"]
