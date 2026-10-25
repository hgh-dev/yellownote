FROM node:22-alpine
WORKDIR /app
COPY server ./server
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server/index.mjs"]
