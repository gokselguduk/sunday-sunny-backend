# Monorepo kökünden: Railway'de Root Directory = repo kökü (.) olmalı.
FROM node:20-bookworm-slim
WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY backend/ ./

ENV NODE_ENV=production
CMD ["node", "src/index.js"]
