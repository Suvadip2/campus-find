FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm ci --omit=dev --workspace=server
COPY server/src ./server/src
RUN mkdir -p /app/server/data && chown -R node:node /app/server
USER node
WORKDIR /app/server
EXPOSE 3000
CMD ["node", "src/server.js"]
