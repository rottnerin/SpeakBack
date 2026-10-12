FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
# Cloud Run sets PORT (8080); server.js reads it.
CMD ["node", "server.js"]
