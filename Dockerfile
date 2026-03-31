# Yerel / isteğe bağlı Docker. Railway varsayılanı artık Nixpacks (railway.toml).
FROM node:20-bookworm
WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY backend/ ./

ENV NODE_ENV=production
CMD ["node", "src/index.js"]
