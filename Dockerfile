# Stage 1: Build dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --production

# Stage 2: Final runtime image
FROM gcr.io/distroless/nodejs20-debian12:nonroot

WORKDIR /app

# Copy results from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY config ./config
COPY helpers ./helpers
COPY models ./models
COPY queries ./queries
COPY public ./public
COPY index.js ./

# Set environment
ENV NODE_ENV=production
ENV NODE_OPTIONS="--enable-source-maps"

# The app listens on port 8083
EXPOSE 8083

# Start application
# The entrypoint in this distroless image is 'node'
CMD ["index.js"]