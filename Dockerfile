# ---- Build web app ----
FROM node:20-alpine AS web-build
WORKDIR /web
COPY holdem-web/package*.json ./
RUN npm install
COPY holdem-web/ ./
RUN npm run build

# ---- Build engine ----
FROM node:20-alpine AS engine-build
WORKDIR /engine
COPY holdem-engine/package*.json ./
RUN npm install
COPY holdem-engine/ ./
RUN npm run build

# ---- Build server ----
FROM node:20-alpine AS server-build
WORKDIR /server
COPY holdem-server/package*.json ./
RUN npm install
COPY holdem-server/ ./
RUN npx tsc -p tsconfig.json

# ---- Runtime ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=engine-build /engine/dist /engine/dist
COPY --from=engine-build /engine/package.json /engine/
COPY --from=server-build /server/node_modules /app/node_modules
COPY --from=server-build /server/dist /app/dist
COPY --from=server-build /server/package.json /app/
COPY --from=web-build /web/dist /web/dist

# Fix the relative path the server uses to find the web dist.
# Server expects ../../holdem-web/dist from its dist/ location.
# We lay it out as /web/dist; patch via env.
ENV WEB_DIST=/web/dist

EXPOSE 2567
CMD ["node", "dist/index.js"]
