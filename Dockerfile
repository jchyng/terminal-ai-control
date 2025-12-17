# Terminal AI Control - Dockerfile
FROM node:18-alpine

# Install build dependencies for node-pty
RUN apk add --no-cache python3 make g++ bash

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY . .

# Expose port
EXPOSE 3000

# Use bash as default shell
ENV SHELL=/bin/bash

# Start server
CMD ["node", "server.js"]
