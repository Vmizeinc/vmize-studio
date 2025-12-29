# Deployment Guide

This document contains practical CI/CD deployment recipes for the project. It covers two common workflows:

- Frontend: Netlify or Vercel (recommended for static sites)
- Backend: Docker + VPS (systemd + Nginx reverse proxy) or GitHub Actions -> VPS

Keep secrets out of the repo. Use your platform's secret management (Netlify/Vercel env vars, GitHub Actions secrets, or a secrets manager).

---

## 1. Frontend (Netlify or Vercel)

Recommended when your frontend is a static site (the repository contains `vmize/frontend` built HTML/CSS/JS).

Netlify
- Create a new site and point it at your repo.
- Build command: none if you're just serving static HTML; otherwise provide your framework build command (e.g., `npm run build`).
- Publish directory: the folder containing your built files (for this repo, set to the top-level of `vmize/frontend` if it contains index.html).
- Environment variables: set `VMIZE_API_URL` to your backend API (e.g., `https://api.example.com`).
- Deploy and test. Netlify will provide HTTPS automatically.

Vercel
- Import project and set the root directory to `vmize/frontend` (if needed).
- Configure build step if necessary and set environment variable `VMIZE_API_URL`.
- Deploy and verify.

Notes
- If you host the frontend on the same host as the backend, you can set `SERVE_STATIC=true` on the backend and avoid cross-origin issues.
- For local testing, you can inject `window.VMIZE_API_URL` in the served HTML or add it at build time.

---

## 2. Backend Deployment Options

Two common approaches are shown below: containerized Docker deployment to VPS with `systemd` + `nginx`, and GitHub Actions workflow that deploys to a VPS via SSH.

Prerequisites
- A server (VPS) with Docker and Docker Compose installed, or at minimum Node + PM2 if you prefer process manager.
- A domain name and DNS pointed to your server.
- An `nginx` reverse proxy configured for TLS (Let’s Encrypt).

### A — Docker + VPS (recommended)

1. Create `Dockerfile` (example):

```Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
ENV NODE_ENV=production
EXPOSE 5000
CMD ["node","server.js"]
```

2. Create `docker-compose.yml` (example):

```yaml
version: '3.8'
services:
  web:
    build: .
    restart: unless-stopped
    env_file: .env.production
    ports:
      - "5000:5000"
    networks:
      - webnet
networks:
  webnet:
```

3. On the VPS:

- Copy `docker-compose.yml` and a production env file (`.env.production`) to the server (use `scp` or CI deployment).
- Run `docker compose up -d --build`.

4. `nginx` reverse proxy (example site config):

```nginx
server {
  listen 80;
  server_name api.example.com;
  location / {
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Then obtain TLS cert with Let's Encrypt (Certbot) or use an automated solution.

### B — GitHub Actions -> VPS (SSH deploy)

Use GitHub Actions to build and copy artifacts and `.env.production` to the server, then run `docker compose up -d --build` or restart the service.

Example GitHub Actions job (high-level):

```yaml
name: Deploy Backend to VPS
on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with: node-version: '18'
      - name: Build (optional)
        run: npm ci && npm run build || true
      - name: Copy to server
        uses: appleboy/scp-action@v0.1.5
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          source: '.'
          target: '/home/deploy/vmize-backend'
      - name: SSH and restart
        uses: appleboy/ssh-action@v0.1.8
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /home/deploy/vmize-backend
            docker compose pull || true
            docker compose up -d --build
```

Use GitHub Secrets to store `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, and any production env values you need.

---

## 3. Stripe Webhooks

- The backend defines `/api/v1/webhooks/stripe`. When deploying, set the webhook endpoint in the Stripe dashboard to `https://api.example.com/api/v1/webhooks/stripe` and add the `STRIPE_WEBHOOK_SECRET` to the server env.
- Webhooks often require the endpoint to accept raw body — `server.js` already handles raw body for that route.

---

## 4. Sample `env.production` (use secrets management in CI)

See `.env.production.example` for a sample template. Do NOT commit secrets to your repo.

---

## 5. Post-deploy smoke checks

- `curl -I https://api.example.com/health` — expect HTTP 200 JSON.
- Verify CORS: run the preflight checks from the browser or `npm run test:cors`.
- Test authentication: register/login and call a protected route.

---

## 6. Rollback and monitoring

- Keep Docker images tagged by commit/CI build ID so you can roll back quickly.
- Add log aggregation (Papertrail, LogDNA, Datadog) and error reporting (Sentry).
- Schedule backups for MongoDB and verify restore procedure.

---

## Secrets & GHCR server login

Add the following GitHub repository secrets (names used by the workflows):

- `GHCR_TOKEN` — Personal access token (PAT) with `read:packages` and `write:packages` scopes for GHCR (if not using `GITHUB_TOKEN`).
- `GHCR_IMAGE` — Optional override for the GHCR image name (e.g. `ghcr.io/<owner>/vmize-backend:latest`).
- `DEPLOY_VIA_SSH` — `true` to enable SSH pull-and-run steps in CI.
- `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_SSH_PORT` — SSH connection details used by the SSH deploy workflow.
- `DEPLOY_HEALTH_URL` — URL to the `/health` endpoint used by CI to post-check the deployment (e.g. `https://api.example.com/health`).

On the server, if you're pulling from GHCR (private image) ensure Docker can authenticate. Create a PAT with `read:packages` scope and run on the server:

```bash
# On the VPS (run once, or add to a startup script)
echo "$PAT" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

Where `$PAT` is a personal access token stored securely (or use a CI-runner with permissions). This logs Docker into GHCR so `docker pull ghcr.io/...` works without additional auth.

If you prefer to use `GITHUB_TOKEN` in Actions, the workflow already logs into GHCR using the value from `GHCR_TOKEN` or `GITHUB_TOKEN` depending on your secret configuration.
