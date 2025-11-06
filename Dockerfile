FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production --omit=dev

# Copy application files
COPY . .

# Expose port (Hugging Face Spaces uses PORT env var)
EXPOSE 7860

# Start the application
CMD ["node", "index.js"]

