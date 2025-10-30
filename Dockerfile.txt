FROM node:21-slim

ENV JELLYFIN_USER "x5ganPYedoUd5FCE"
ENV JELLYFIN_PASSWORD "x3VH8O5NucRCmXaW"
ENV SERVER_PORT 443
ENV JELLYFIN_SERVER "https://ku98faa.freshticks.xyz"

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app

COPY package*.json ./
COPY *.js ./

RUN chown -R node:node /home/node/app

USER node
RUN npm install

EXPOSE $SERVER_PORT
ENTRYPOINT ["nodejs", "server.js"]
