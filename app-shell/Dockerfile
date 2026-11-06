# Bukmarkz web app: multi-stage build for Coolify (or any Docker host). Next.js "standalone" output.
# NEXT_PUBLIC_* values are baked into the browser bundle at BUILD time, so they are build args (set them in Coolify as "Build Variable").
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# No lockfile has been generated yet: commit one after the first `npm install` and this switches to a reproducible `npm ci`.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next imports server modules while collecting page data, and the Supabase client throws on an empty URL. Placeholders are used ONLY for this build step
# and are not stored in any image layer's ENV: real server secrets are runtime variables in Coolify.
RUN SUPABASE_URL="${SUPABASE_URL:-https://build.placeholder.invalid}" SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-build-placeholder}" \
    SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-build-placeholder}" npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && groupadd -r app && useradd -r -g app -m app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
