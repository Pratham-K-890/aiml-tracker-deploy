"""
Migrate data from Supabase (REST API) → local SQLite.

Run inside the container:
    docker compose exec \
        -e SUPABASE_URL=https://xxx.supabase.co \
        -e SUPABASE_SERVICE_KEY=eyJ... \
        app python migrate_from_supabase.py

All migrated users get password 'changeme123' — they must reset it.
The admin account created by seed_admin.py is left untouched.
"""

import os, sys, requests
from passlib.context import CryptContext
from database import init_db, fetchone, execute, new_id

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
DEFAULT_PASSWORD = "changeme123"

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars.")
    sys.exit(1)

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
_DEFAULT_HASH = _pwd.hash(DEFAULT_PASSWORD)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Accept": "application/json",
}


def sb_fetch(table: str, select: str = "*") -> list[dict]:
    """Fetch all rows from a Supabase table (handles pagination)."""
    rows, offset, limit = [], 0, 1000
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers={**HEADERS, "Range": f"{offset}-{offset + limit - 1}",
                     "Range-Unit": "items", "Prefer": "count=none"},
            params={"select": select},
            timeout=30,
        )
        r.raise_for_status()
        batch = r.json()
        rows.extend(batch)
        if len(batch) < limit:
            break
        offset += limit
    return rows


def migrate_profiles():
    print("→ profiles …", end=" ", flush=True)
    rows = sb_fetch("profiles")
    count = 0
    for r in rows:
        uid = r.get("id") or new_id()
        email = (r.get("email") or "").lower().strip()
        if not email:
            continue
        if fetchone("SELECT id FROM profiles WHERE email = ?", (email,)):
            continue
        execute(
            "INSERT OR IGNORE INTO profiles (id, email, name, usn, role, approved, password_hash) "
            "VALUES (?,?,?,?,?,?,?)",
            (uid, email, r.get("name"), r.get("usn"),
             r.get("role", "student"), int(r.get("approved", 1)), _DEFAULT_HASH),
        )
        count += 1
    print(f"{count} inserted")


def migrate_batch():
    print("→ batch …", end=" ", flush=True)
    rows = sb_fetch("batch")
    count = 0
    for r in rows:
        execute(
            "INSERT OR IGNORE INTO batch (batch_id, batch_name, year) VALUES (?,?,?)",
            (r["batch_id"], r["batch_name"], r.get("year")),
        )
        count += 1
    print(f"{count} inserted")


def migrate_semester():
    print("→ semester …", end=" ", flush=True)
    rows = sb_fetch("semester")
    count = 0
    for r in rows:
        execute(
            "INSERT OR IGNORE INTO semester "
            "(semester_id, sem_number, batch_id, project_status, project_active) "
            "VALUES (?,?,?,?,?)",
            (r["semester_id"], r["sem_number"], r["batch_id"],
             r.get("project_status"), int(bool(r.get("project_active", False)))),
        )
        count += 1
    print(f"{count} inserted")


def migrate_course():
    print("→ course …", end=" ", flush=True)
    rows = sb_fetch("course")
    count = 0
    for r in rows:
        execute(
            "INSERT OR IGNORE INTO course (course_id, course_name, semester_id) VALUES (?,?,?)",
            (r["course_id"], r["course_name"], r["semester_id"]),
        )
        count += 1
    print(f"{count} inserted")


def migrate_coordinator():
    print("→ coordinator …", end=" ", flush=True)
    rows = sb_fetch("coordinator")
    count = 0
    for r in rows:
        execute(
            "INSERT OR IGNORE INTO coordinator (course_id, user_id) VALUES (?,?)",
            (r["course_id"], r["user_id"]),
        )
        count += 1
    print(f"{count} inserted")


def migrate_project():
    print("→ project …", end=" ", flush=True)
    rows = sb_fetch("project")
    count = 0
    for r in rows:
        execute(
            "INSERT OR IGNORE INTO project "
            "(project_id, title, github, guide, guide_id, course_id, team_number, readme_cache) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (r["project_id"], r["title"], r.get("github"), r.get("guide"),
             r.get("guide_id"), r["course_id"], r.get("team_number"),
             r.get("readme_cache")),
        )
        count += 1
    print(f"{count} inserted")


def migrate_student():
    print("→ student …", end=" ", flush=True)
    rows = sb_fetch("student")
    count = 0
    for r in rows:
        execute(
            "INSERT OR IGNORE INTO student (student_id, name, usn, project_id) VALUES (?,?,?,?)",
            (r["student_id"], r["name"], r.get("usn"), r["project_id"]),
        )
        count += 1
    print(f"{count} inserted")


def migrate_project_examiner():
    print("→ project_examiner …", end=" ", flush=True)
    rows = sb_fetch("project_examiner")
    count = 0
    for r in rows:
        # Supabase col is user_id; SQLite schema also uses user_id
        execute(
            "INSERT OR IGNORE INTO project_examiner (id, project_id, user_id) VALUES (?,?,?)",
            (r["id"], r["project_id"], r["user_id"]),
        )
        count += 1
    print(f"{count} inserted")


def migrate_review():
    print("→ review …", end=" ", flush=True)
    rows = sb_fetch("review")
    count = 0
    for r in rows:
        # Supabase: review_name / review_date → SQLite: title / date (both NOT NULL)
        title = r.get("review_name") or r.get("title") or "Review"
        date  = r.get("review_date") or r.get("date") or "2024-01-01"
        execute(
            "INSERT OR IGNORE INTO review (review_id, course_id, title, date, description) "
            "VALUES (?,?,?,?,?)",
            (r["review_id"], r["course_id"], title, date, r.get("description")),
        )
        count += 1
    print(f"{count} inserted")


def migrate_evaluation_review():
    print("→ evaluation_review …", end=" ", flush=True)
    rows = sb_fetch("evaluation_review")
    count = 0
    for r in rows:
        # Supabase PK is 'id'
        execute(
            "INSERT OR IGNORE INTO evaluation_review "
            "(id, course_id, review_number, is_locked) VALUES (?,?,?,?)",
            (r["id"], r["course_id"], r["review_number"],
             int(bool(r.get("is_locked", True)))),
        )
        count += 1
    print(f"{count} inserted")


def migrate_evaluation_mark():
    print("→ evaluation_mark …", end=" ", flush=True)
    rows = sb_fetch("evaluation_mark")
    count = 0
    for r in rows:
        execute(
            "INSERT OR IGNORE INTO evaluation_mark "
            "(id, eval_review_id, project_id, student_id, scorer_id, scorer_type, "
            "c1, c2, c3, c4, c5, submitted_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (r["id"], r["eval_review_id"], r["project_id"],
             r["student_id"], r["scorer_id"], r["scorer_type"],
             r.get("c1"), r.get("c2"), r.get("c3"), r.get("c4"), r.get("c5"),
             r.get("submitted_at")),
        )
        count += 1
    print(f"{count} inserted")


def migrate_course_document():
    print("→ course_document …", end=" ", flush=True)
    rows = sb_fetch("course_document")
    count = 0
    for r in rows:
        # Supabase may use doc_id or id as PK; name may be file_name
        doc_id   = r.get("doc_id") or r.get("id") or new_id()
        name     = r.get("file_name") or r.get("name") or "document"
        file_url = r.get("file_url", "")
        created  = r.get("uploaded_at") or r.get("created_at")
        execute(
            "INSERT OR IGNORE INTO course_document (id, course_id, name, file_url, created_at) "
            "VALUES (?,?,?,?,?)",
            (doc_id, r["course_id"], name, file_url, created),
        )
        count += 1
    print(f"{count} inserted (file URLs point to Supabase Storage — files not downloaded)")


if __name__ == "__main__":
    print("Initialising SQLite schema …")
    init_db()

    print("Fetching and inserting data from Supabase …")
    migrate_profiles()
    migrate_batch()
    migrate_semester()
    migrate_course()
    migrate_coordinator()
    migrate_project()
    migrate_student()
    migrate_project_examiner()
    migrate_review()
    migrate_evaluation_review()
    migrate_evaluation_mark()
    migrate_course_document()

    print(f"\nDone. All migrated users have password: {DEFAULT_PASSWORD!r}")
    print("They should change it after first login.")
