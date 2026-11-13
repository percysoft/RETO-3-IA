# syntax=docker/dockerfile:1

# ---------- Etapa 1: dependencias de producción (solo zod y @anthropic-ai/sdk) ----------
FROM oven/bun:1.4.4-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---------- Etapa 2: imagen final ----------
FROM oven/bun:1.4.4-slim
WORKDIR /app

# Sin secretos: LLM_API_KEY y ACCESS_KEY se inyectan en tiempo de ejecución (Render las guarda como
# secretos del servicio). NUNCA se declaran con ENV ni ARG en este archivo.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    EPHEMERAL_STORAGE=true

COPY --from=deps /app/node_modules ./node_modules
# Copia EXPLÍCITA de lo necesario (no "COPY . ."): código, prompt, conocimiento, front y fixtures de solo lectura.
COPY package.json tsconfig.json ./
COPY src ./src
COPY agent ./agent
COPY web ./web
COPY fixtures ./fixtures

# out/ es el único directorio de escritura. Con almacenamiento efímero se vacía en cada reinicio.
RUN mkdir -p /app/out && chown -R bun:bun /app/out
USER bun

EXPOSE 10000
CMD ["bun", "run", "src/server.ts"]
