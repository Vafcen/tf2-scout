FROM node:24-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY src ./src
ENV PORT=4400 HOST=0.0.0.0 DATA_DIR=/data DESKTOP_NOTIFY=false
VOLUME ["/data"]
EXPOSE 4400
CMD ["node", "src/index.ts"]
