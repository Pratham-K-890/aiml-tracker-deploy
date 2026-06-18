# AIML Project Tracker — Deployment Guide

## Requirements
- Docker installed on your server/machine
- A Groq API key (free at console.groq.com)

## Steps

### 1. Install Docker (Linux server)
```bash
curl -fsSL https://get.docker.com | sh
```

### 2. Clone this repo
```bash
git clone https://github.com/Pratham-K-890/aiml-tracker-deploy.git
cd aiml-tracker-deploy
```

### 3. Configure environment
```bash
cp .env.example .env
nano .env
```
Fill in:
- `JWT_SECRET` — any long random string (run `openssl rand -hex 32`)
- `GROQ_API_KEY` — your key from console.groq.com

### 4. Start the app
```bash
docker compose up -d
```

### 5. Load existing data (first time only)
```bash
docker compose cp tracker.db app:/data/tracker.db
docker compose restart app
```

### 6. Open the app
Visit `http://<your-server-ip>:8000`

Login with:
- Email: `admin@dsce.edu.in`
- Password: `admin123`

> Change the admin password after first login via Admin → Users → Reset PW.

## Stopping / Starting
```bash
docker compose down   # stop (data is preserved)
docker compose up -d  # start again
```

## Updating to latest image
```bash
docker compose pull
docker compose up -d
```
