# Backend - Quick Start

This file documents common developer commands to run and test the backend locally.

Prerequisites
- Node.js (>=16)
- MongoDB running and reachable
- Copy or create a `.env` with at least: `MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET`.

Common scripts (run from `Backend`)

- Install dependencies
```bash
npm install
```

- Start (production-like)
```bash
npm start
```

- Start in dev with file watcher (requires `nodemon`)
```bash
npm run dev
```

- Quick connectivity check (hits `/health`)
```bash
npm run check:connectivity
```

- Endpoint smoke tests (register/login/track)
```bash
npm run test:endpoints
```

- Try-on flow test (mocks external Fashn.AI)
```bash
npm run test:tryon-flow
```

Environment variables and options
- To run tests against an existing account (skip registration):
  ```bash
  SKIP_REGISTER=true EMAIL=you@example.com PASSWORD=YourPass npm run test:tryon-flow
  ```
- To change host/port used by the scripts:
  ```bash
  HOST=127.0.0.1 PORT=5000 npm run test:tryon-flow
  ```

Notes
- The try-on test uses `nock` to mock `https://api.fashn.ai` so it does not call external services.
- If you serve the frontend separately, inject an API base before your app scripts:
  ```html
  <script>window.VMIZE_API_URL = 'http://localhost:5000'</script>
  ```

Troubleshooting
- 401 on login: verify `JWT_SECRET` and that the user exists (or use `SKIP_REGISTER=false` to create a test user).
- Mongo connection errors: confirm `MONGODB_URI` and that MongoDB is running.
