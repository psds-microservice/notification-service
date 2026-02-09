FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci 2>/dev/null || npm install
COPY tsconfig.json ./
COPY proto ./proto
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/proto ./proto
EXPOSE 8092 8094
CMD ["node", "dist/index.js"]
