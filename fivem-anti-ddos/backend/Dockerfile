# syntax=docker/dockerfile:1
# FX Shield backend + dashboard in one small image.
#   docker build -t fxshield backend
#   docker run -d -p 8080:8080 -v fxshield-data:/data fxshield

# ── build: compile the server and bundle the dashboard ───────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY dashboard/package.json dashboard/
RUN npm ci
COPY . .
RUN npm run build

# ── runtime: production dependencies + build output only ─────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATABASE_PATH=/data/fxshield.db
WORKDIR /app
COPY package.json package-lock.json ./
COPY dashboard/package.json dashboard/
# the dashboard's packages are devDependencies (they are bundled at build time) → not installed here
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dashboard/dist ./dashboard/dist
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
