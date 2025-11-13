FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source and build
COPY . .
RUN npm run build

# Expose port
EXPOSE 3001

# Start the service
CMD ["npm", "start"]
