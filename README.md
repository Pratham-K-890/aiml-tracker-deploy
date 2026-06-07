# 🎓 AIML Department Mini Project Tracker

**Live Application:** https://mini-project-tracker-henna.vercel.app/login

---

## 🔍 About the Project

The **AIML Department Mini Project Tracker** is a full-stack web application built to digitize and streamline the entire mini project management process for the AIML Department. It brings everything under one roof — coordinators can manage batches, create teams, assign guides and evaluators, and record marks for all three reviews. Faculty can view their assigned projects, and students can log in anytime to check their project details and review scores.

The system is built around a four-level role hierarchy, ensuring each user has access only to what is relevant to their role.

---

## ✨ Key Features

**📁 Project and Batch Management**
Coordinators can create semesters, batches, and student teams. Each team's project details — including title, description, and members — are stored and managed in one place.

**👨‍🏫 Guide and Evaluator Assignment**
Once teams are created, the coordinator assigns a faculty guide and evaluators to each team, ensuring proper academic oversight throughout the semester.

**📊 Three-Review Marks System**
The platform supports marks entry for all three review stages. Marks are instantly reflected in the team's profile, giving students and faculty real-time visibility into academic progress.

**🤖 AI-Powered Project Search**
An intelligent chatbot powered by Google Gemini allows users to search for any project using plain English — by semester, year, batch, guide name, or student name.

**👁️ Student Portal**
Students have a dedicated read-only view to check their team's project details, assigned faculty, and review marks without needing to contact anyone manually.

---

## 👥 User Roles and Permissions

**🔴 HOD / Admin** — Full access across all batches, semesters, coordinators, and marks. Responsible for overall oversight and user management.

**🟠 Coordinator** — Manages a specific semester. Can create batches, add teams, assign guides and evaluators, and enter marks for all three reviews.

**🟡 Teacher** — Can view projects where assigned as a guide or evaluator, along with team details and review progress.

**🟢 Student** — View-only access to their own team's project information, assigned faculty, and review marks.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React.js |
| Backend | FastAPI (Python) |
| Database | Supabase (PostgreSQL) |
| AI Chatbot | Google Gemini |
| Deployment | Vercel |

---

## 🚀 Getting Started

### Prerequisites
- Node.js v18+
- Python v3.9+
- Supabase project configured
- Google Gemini API key

### Installation

Clone the repository:
```bash
git clone https://github.com/Pratham-K-890/MiniProjectTracker.git
cd MiniProjectTracker
```

Set up the backend:
```bash
cd backend
pip install -r requirements.txt
```

Create a `.env` file in `backend/`:
```
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_anon_key
GEMINI_API_KEY=your_gemini_api_key
```

Run the backend:
```bash
uvicorn main:app --reload
```

Set up the frontend:
```bash
cd web
npm install
```

Create a `.env` file in `web/`:
```
VITE_API_URL=http://localhost:8000
```

Run the frontend:
```bash
npm run dev
```

---

## 📁 Project Structure

```
MiniProjectTracker/
├── backend/               # FastAPI backend
│   ├── main.py
│   ├── routes/
│   ├── models/
│   └── requirements.txt
├── web/                   # React frontend
│   ├── src/
│   └── package.json
├── render.yaml
└── .gitignore
```

---

## 🔐 Authentication

All users are pre-registered by the Admin — there is no public sign-up. Users log in with their assigned credentials, and the system automatically grants access based on their role.

---

## 🤝 Contributing

Contributions from team members are welcome. Create a new branch, make your changes, and open a Pull Request with a clear description of what you have changed and why.

---

## 👨‍💻 Team

Built by students of the **AIML Department** to make project administration more efficient, transparent, and accessible for everyone — from the HOD to the student.
