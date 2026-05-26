FROM node:22-alpine
RUN npm install -g npm@latest
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts && \
    rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx
COPY server.js scanner.js companies.js ./
EXPOSE 3006
CMD ["node", "server.js"]
