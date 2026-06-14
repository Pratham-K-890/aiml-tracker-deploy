# AIML Department Project Tracker

A full-stack web application to manage mini and major projects across batches, semesters, and courses for the AIML Department.

---

## About

The **AIML Department Project Tracker** digitalises the entire project lifecycle — from batch creation to final evaluation marks. Coordinators manage teams, assign guides and examiners, and record review marks. Faculty view their assigned projects. Students check their project status and review scores. An AI chatbot lets anyone search projects in plain English.

---

## Features

**Batch & Semester Hierarchy**
Admins create batches, semesters, and courses. Each semester can be flagged as a Mini or Major project cycle, active or inactive.

**Team Management**
Coordinators create teams manually or via Excel bulk upload. Each team has a project title, GitHub link, and up to 4 students.

**Guide & Examiner Assignment**
Faculty guides and up to 2 examiners are assigned per team. Teachers see only their own assigned projects.

**Three-Review Evaluation System**
Marks entry for all three review stages with a fixed rubric:
- Review 1 (Problem & Design): 5 criteria × 10 = 50 marks
- Review 2 (Implementation): 5 criteria × 10 = 50 marks
- Review 3 (Demonstration): 4 criteria × 25 = 100 marks

Each review can be locked/unlocked by the coordinator. Marks are downloadable as a formatted Excel sheet matching the department template.

**AI Chatbot**
Natural language project search powered by Groq (Llama 3.1). Ask things like:
- *"Show ML projects guided by Vindhya mam in sem 5"*
- *"Which guide has the most projects in batch 2024-2028?"*
- *"Python projects in sem 3"*

**AI README Explain & Suggest**
For any project with a GitHub link, the AI can summarise the README and suggest improvements based on similar popular repositories.

**Course Documents**
Coordinators can upload reference documents per course. All users can download them.

**Role-Based Access**
No public sign-up. Accounts are created by the admin. Access is determined by role on every request.

---

## User Roles

| Role | Access |
|------|--------|
| **Admin / HOD** | Full access — user management, all batches, all courses, all marks |
| **Coordinator** | Manages assigned courses — creates teams, assigns faculty, enters marks |
| **Teacher** | Views projects where assigned as guide or examiner |
| **Student** | Read-only view of own team, assigned faculty, and review marks |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite |
| Backend | FastAPI (Python 3.11+) |
| Database | Supabase (PostgreSQL) |
| AI Chatbot | Groq API — Llama 3.1 8B |
| GitHub Integration | GitHub REST API |
| Production Server | Gunicorn + Uvicorn workers |
| Reverse Proxy | nginx |

---

## Project Structure

```
MiniProjectTracker/
├── backend/
│   ├── main.py                # FastAPI entry point, CORS, exception handler
│   ├── project_tracker.py     # Core CRUD — batches, courses, projects, marks
│   ├── auth_router.py         # Login, account creation, bulk student upload
│   ├── chatbot.py             # NL filter, explain, suggest endpoints
│   ├── jwt_auth.py            # JWT verification, role guards
│   ├── github_utils.py        # GitHub API — README fetch, repo search
│   ├── requirements.txt
│   └── sql/                   # DB migration scripts (run in Supabase SQL Editor)
├── web/
│   ├── src/
│   │   ├── pages/             # LoginPage, BatchesPage, ProjectsPage, etc.
│   │   ├── components/        # Layout, Modal, Spinner
│   │   ├── context/           # AuthContext
│   │   ├── api.js             # All API call functions
│   │   └── auth.js            # Token helpers
│   └── package.json
├── deploy/
│   ├── nginx.conf             # nginx site config for bare metal
│   ├── project-tracker.service # systemd unit file
│   └── deploy.sh              # One-command install/update script
├── render.yaml                # Render cloud deployment config
└── README.md
```

---

## Getting Started (Local Dev)

### Prerequisites
- Python 3.11+
- Node.js 18+
- A Supabase project with migrations applied (`backend/sql/` in order)
- Groq API key (free at console.groq.com)

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Copy and fill in environment variables:
```bash
cp .env.example .env
```

```env
SUPABASE_URL=https://<your-project-ref>.supabase.co/rest/v1/
SUPABASE_SERVICE_KEY=<service-role-key>
SUPABASE_JWT_SECRET=<jwt-secret>
GROQ_API_KEY=<groq-api-key>
GROQ_MODEL=llama-3.1-8b-instant
GITHUB_TOKEN=               # optional — raises rate limit to 5000/hr
ALLOWED_ORIGINS=*           # lock down to your domain in production
```

Run:
```bash
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd web
npm install
```

Create `web/.env`:
```env
VITE_API_URL=http://localhost:8000
```

Run:
```bash
npm run dev
```

---

## Deployment

### Cloud (Render)
Push to `main`. Render picks up `render.yaml` automatically and runs:
```
gunicorn main:app -w 2 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT --timeout 120
```
Host the frontend separately (Vercel, Netlify, or Render static site).

### Bare Metal (Department Server)
For a local server on the college LAN:

```bash
# First-time setup
sudo apt install git nginx python3 python3-venv nodejs npm
sudo git clone https://github.com/Pratham-K-890/MiniProjectTracker.git /opt/project-tracker
sudo cp /opt/project-tracker/backend/.env.example /opt/project-tracker/backend/.env
# edit .env with your values

sudo cp /opt/project-tracker/deploy/project-tracker.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable project-tracker

sudo cp /opt/project-tracker/deploy/nginx.conf /etc/nginx/sites-available/project-tracker
sudo ln -s /etc/nginx/sites-available/project-tracker /etc/nginx/sites-enabled/

# Deploy / update
sudo bash /opt/project-tracker/deploy/deploy.sh
```

After deployment, the app is available at `http://<server-ip>` on the local network.

---

## Database Migrations

Run scripts in the `backend/sql/` folder in order via the Supabase SQL Editor:

| File | Purpose |
|------|---------|
| `05_ensure_schema.sql` | Core tables, RLS off |
| `06_project_status.sql` | Mini/major status on semester |
| `07_project_active.sql` | Active flag on semester |
| `08_teams_and_examiners.sql` | Team numbers, examiner junction table |
| `09_evaluation.sql` | Evaluation reviews and marks tables |

---

## Authentication

All accounts are created by an admin — there is no public sign-up. Users log in with their assigned email and password. The backend validates every request against a Supabase-issued JWT (ES256).
