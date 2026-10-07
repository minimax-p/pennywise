# Pennywise production image: Next.js standalone server.
# The "builder" stage also runs database migrations (see docker-compose.yml).

FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS builder
# The type check during the build needs more memory than Node allows by default,
# which ran out on the 1 GB server. It can use swap for the rest.
ENV NODE_OPTIONS=--max-old-space-size=1536
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN useradd --system --uid 1001 --no-create-home pennywise
COPY --from=builder /app/public ./public
COPY --from=builder --chown=pennywise /app/.next/standalone ./
COPY --from=builder --chown=pennywise /app/.next/static ./.next/static
USER pennywise
EXPOSE 3000
CMD ["node", "server.js"]
