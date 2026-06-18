# Build + run the Legalithm MCP server (stdio) for Glama's automated check.
# Build context: this directory (packages/mcp-server).
FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build
# stdio MCP server: starts and responds to introspection (tools/list), no API key.
ENTRYPOINT ["node", "dist/index.js"]
