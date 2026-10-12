FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm ci --omit=dev --workspace=server
COPY server/src ./server/src
RUN apk add --no-cache su-exec && mkdir -p /app/data /app/server/data && chown -R node:node /app/data /app/server/data
WORKDIR /app/server
EXPOSE 3000
CMD ["sh", "-c", "chown -R node:node /app/data && exec su-exec node node src/server.js"]
