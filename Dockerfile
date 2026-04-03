# Stage 1: Build dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install only production dependencies
# This keeps the node_modules lean
RUN npm ci --production

# Stage 2: Final runtime image (Distroless)
# Using 'nonroot' version for better security
FROM gcr.io/distroless/nodejs20-debian12:nonroot

WORKDIR /app

# Copy node_modules and package.json from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Copy application source code
# Ensure these folders exist in your local directory
COPY config ./config
COPY helpers ./helpers
COPY models ./models
COPY queries ./queries
COPY services ./services
COPY public ./public
COPY index.js ./

# Set environment variables
ENV NODE_ENV=production
# Source maps are helpful for debugging in distroless since you can't 'cat' files
ENV NODE_OPTIONS="--enable-source-maps"

# The app listens on port 8083 (per your http.listen code)
EXPOSE 8083

# Start application
# 'node' is the implicit entrypoint in this distroless image
CMD ["index.js"]
