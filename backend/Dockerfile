# Railway Root Directory = "backend" iken bu dosya kullanılır (build bağlamı = backend klasörü).
FROM node:20-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . ./

ENV NODE_ENV=production
CMD ["node", "src/index.js"]
