FROM oven/bun:latest as base
WORKDIR /app

# Install dependencies only
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# Copy source and build
COPY . .
RUN bun run build

# Serve the built files
EXPOSE 8153
CMD ["bun", "run", "preview", "--host", "--port", "8153"]