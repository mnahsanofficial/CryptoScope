# Node.js 24 (LTS) because it exposes ML-DSA (FIPS 204) in node:crypto, used by the crypto-agility module.
# ---- Stage 1: install all deps and compile TypeScript ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- Stage 2: small runtime image with only compiled JS + production deps ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Run as the unprivileged "node" user that ships with the image.
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
