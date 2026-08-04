FROM node:20-bookworm-slim

WORKDIR /squid

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV DB_HOST=db \
    DB_PORT=5432 \
    DB_NAME=squid \
    DB_USER=squid \
    DB_PASS=squid \
    CHAIN_ID=8453 \
    GQL_PORT=4350

EXPOSE 4350

CMD ["node", "lib/main.js"]
