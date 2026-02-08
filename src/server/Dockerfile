FROM node:20-alpine

WORKDIR /app

COPY src/server/package*.json ./src/server/
RUN cd src/server && npm install --omit=dev

COPY src/server ./src/server
COPY js/libs ./js/libs

WORKDIR /app/src/server
ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "index.js"]
