# Vmize Studio Frontend Production Deployment

## Netlify
- Set `publish = "."` in `netlify.toml` (already present).
- Set environment variable `VMIZE_API_URL` to your backend API (e.g., `https://api.example.com`).
- Deploy and verify HTTPS and redirects.

## Vercel
- Set root directory to `frontend`.
- Set environment variable `VMIZE_API_URL`.
- Deploy and verify.

## Custom Hosting
- Serve static files from `frontend/`.
- Ensure CORS and API URL are set for backend communication.

## Security
- Review security headers in `netlify.toml`.
- Use HTTPS for all production traffic.

## API Key
- Use your production API key in widget configuration and dashboard.

---
For backend deployment, see `/backend/DEPLOYMENT.md` and `/backend/.env.production.example`.
