// Auto-extracted from tools/scaffold.ts (PR #153, audit cleanup).
// Container files: Dockerfile, .dockerignore.

type ProjectType = "node" | "go" | "python" | "rust" | "java" | "generic"

// ─── Container Files Generation ─────────────────────────────────────

export function generateDockerfile(pt: ProjectType): string {
  const dockerfiles: Record<ProjectType, string> = {
    node: `# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine
WORKDIR /app
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package*.json ./
EXPOSE 3000
USER appuser
CMD ["node", "dist/index.js"]
`,
    go: `# Stage 1: Build
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /app/bin/server .

# Stage 2: Runtime
FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/bin/server /server
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/server"]
`,
    python: `# Stage 1: Build
FROM python:3.12-slim AS builder
WORKDIR /app
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Stage 2: Runtime
FROM python:3.12-slim
WORKDIR /app
RUN groupadd -g 1001 appgroup && useradd -u 1001 -g appgroup -m appuser
COPY --from=builder --chown=appuser:appgroup /opt/venv /opt/venv
COPY --from=builder --chown=appuser:appgroup /app .
ENV PATH="/opt/venv/bin:$PATH"
EXPOSE 8000
USER appuser
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
`,
    rust: `# Stage 1: Build
FROM rust:1.77-alpine AS builder
WORKDIR /app
RUN apk add --no-cache musl-dev
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY . .
RUN cargo build --release

# Stage 2: Runtime
FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/target/release/app /app
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app"]
`,
    java: `# Stage 1: Build
FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /app
COPY pom.xml ./
RUN mvn dependency:resolve
COPY . .
RUN mvn package -DskipTests

# Stage 2: Runtime
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser
COPY --from=builder --chown=appuser:appgroup /app/target/*.jar app.jar
EXPOSE 8080
USER appuser
CMD ["java", "-jar", "app.jar"]
`,
    generic: `FROM alpine:3.19
WORKDIR /app
COPY . .
EXPOSE 8080
CMD ["sh", "-c", "echo 'Replace this with your application command'"]
`,
  }
  return dockerfiles[pt]
}

export function generateDockerignore(pt: ProjectType): string {
  const common = `.git
.gitignore
.env
.env.*
*.md
LICENSE
.DS_Store
tmp/
.cache/
cicd/terraform/
cicd/cloudbuild*.yaml
`
  const extras: Record<ProjectType, string> = {
    node: `node_modules/
dist/
coverage/
.next/
.nuxt/
`,
    go: `bin/
vendor/
`,
    python: `__pycache__/
*.pyc
.venv/
venv/
.eggs/
*.egg-info/
.pytest_cache/
.mypy_cache/
`,
    rust: `target/
`,
    java: `target/
build/
.gradle/
`,
    generic: `build/
out/
`,
  }
  return common + extras[pt]
}

