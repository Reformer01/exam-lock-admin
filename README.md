# Exam Lock Admin

A Chrome/Edge extension and Node.js backend that locks down a student’s browser during online assessments and records rule-breaking events.  
This repository contains two deployable pieces:

1. **Frontend Extension** – React + Vite source in `src/` packaged by `manifest.json`.
2. **Backend Service** – Express server in `backend/` that stores events in Firebase Firestore and exposes two endpoints:
   * `GET  /health` – simple health check  
   * `POST /events` – receives exam-session events (payload validated + stored)

---

## Tech Stack

| Layer         | Tech                              |
|---------------|-----------------------------------|
| Extension UI  | React + Vite + TypeScript + Tailwind |
| Backend       | Node 18 • Express 4 • Firebase Admin SDK |
| Storage       | Google Cloud Firestore            |
| Hosting       | Render free tier (Blueprint YAML) |

---

## Local Development

```bash
# 1. Install root dependencies (extension)
npm install

# 2. Install backend dependencies
npm --prefix backend install

# 3. Run backend locally on http://localhost:3000
npm --prefix backend run dev

# 4. Start the extension dev server (hot-reload)
npm run dev
```

> **Prerequisite:** Node ≥ 18.  
> Create `backend/service-account-key.json` *or* set the ENV vars below so the backend can authenticate with Firebase.

### Environment Variables (backend)

| Key                    | Description                                             |
|------------------------|---------------------------------------------------------|
| `FIREBASE_PROJECT_ID`  | Firebase / GCP project ID                               |
| `FIREBASE_CLIENT_EMAIL`| Service-account client email                            |
| `FIREBASE_PRIVATE_KEY` | Service-account private key (replace `\n` with newline) |
| `API_KEYS`             | Comma-separated list of valid admin API keys            |

When running locally you can create a `.env` file in `backend/` and `nodemon` will pick it up if you install `dotenv` (optional).

---

## Deploy to Render

Render supports "Blueprint" deployments via `render.yaml`; the file in this repo provisions a free web service named **`exam-lock-backend`**.

1. Push this repository to GitHub.
2. Log in to <https://dashboard.render.com>.
3. Click **New → Blueprint** and select the repo.
4. Fill in the required environment variables (see table above).
5. Click **Apply** – build + deploy takes ~1 min.
6. Note the resulting base URL (e.g. `https://exam-lock-backend.onrender.com`).

Every `git push` to `main` automatically triggers a new deploy.

---

## API Reference

### GET `/health`
Returns status of the service.
```json
{
  "status": "ok",
  "ts": 1694864760000
}
```

### POST `/events`
Headers:
```
Authorization: Bearer <API_KEY>
Content-Type: application/json
```
Body example:
```json
{
  "type": "violation",
  "payload": {
    "rule": "copy_paste",
    "details": "User attempted to copy text at 10:02:15"
  }
}
```
Successful response:
```json
{ "ok": true, "id": "Bfqw32WrsmNx" }
```

---

## Contributing
Pull requests are welcome! For major changes please open an issue first to discuss what you would like to change.

---

## License
[MIT](LICENSE) © 2025 Rick Sanchez
