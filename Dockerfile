FROM node:20-slim

WORKDIR /app

# Copy package.json first (required for npm install)
COPY package.json ./

# Verify package.json exists
RUN test -f package.json || (echo "ERROR: package.json not found!" && ls -la && exit 1)

# Copy package-lock.json if it exists (optional)
COPY package-lock.json* ./

# Install dependencies
RUN npm install --production --omit=dev

# Copy the rest of the application files
COPY . .

# Expose port (Hugging Face Spaces uses PORT env var)
EXPOSE 7860

# Start the application
CMD ["node", "index.js"]

