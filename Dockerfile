FROM node:20-slim

WORKDIR /app

# Set npm registry and timeout for better reliability
ENV NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
ENV NPM_CONFIG_FETCH_TIMEOUT=60000
ENV NPM_CONFIG_INSTALL_TIMEOUT=60000

# Copy package files first for better caching
COPY package.json package-lock.json* ./

# Verify package.json exists
RUN test -f package.json || (echo "ERROR: package.json not found!" && ls -la && exit 1)

# Install dependencies with explicit flags and progress logging
RUN npm install --production --omit=dev --no-audit --no-fund --progress=false || \
    (echo "npm install failed, trying with cache..." && npm cache clean --force && npm install --production --omit=dev --no-audit --no-fund)

# Copy the rest of the application files
COPY . .

# Expose port (Hugging Face Spaces uses PORT env var)
EXPOSE 7860

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:7860/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "index.js"]

