# Stage 1: Install backend dependencies
FROM node:22-bookworm-slim AS backend-build

WORKDIR /app

COPY backend/package*.json ./backend/

RUN cd backend && npm ci --omit=dev


# Stage 2: Production runtime
FROM node:22-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app

COPY --from=backend-build /app/backend/node_modules ./backend/node_modules

COPY backend/ ./backend/

# If the backend serves frontend files, copy the frontend
# build output here after configuring the frontend build.
# Example:
# COPY --from=frontend-build /app/dist ./frontend/dist

WORKDIR /app/backend

EXPOSE 3000

CMD ["npm", "start"]
