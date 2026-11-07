FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY server ./server
COPY client ./client
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=4000
ENV DATABASE_PATH=/app/data/mess.sqlite
ENV PAYMENTS_MODE=FAKE
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/data /app/backups && chown -R node:node /app
COPY --from=build --chown=node:node /app/dist ./dist
USER node
VOLUME ["/app/data", "/app/backups"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
