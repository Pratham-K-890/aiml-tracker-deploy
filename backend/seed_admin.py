"""
First-run helper: create the initial admin account.

Usage (run inside the container or locally after setting DB_PATH):
    python seed_admin.py

Reads ADMIN_EMAIL and ADMIN_PASSWORD from environment (or .env file).
Skips silently if an account with that email already exists.
"""
import os
import sys

from dotenv import load_dotenv
load_dotenv()

from database import init_db, fetchone, execute, new_id

try:
    from passlib.context import CryptContext
except ImportError:
    print("ERROR: passlib not installed. Run: pip install passlib[bcrypt]")
    sys.exit(1)

_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

email    = os.getenv("ADMIN_EMAIL", "").strip().lower()
password = os.getenv("ADMIN_PASSWORD", "").strip()

if not email or not password:
    print("ERROR: Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables.")
    sys.exit(1)

if len(password) < 6:
    print("ERROR: ADMIN_PASSWORD must be at least 6 characters.")
    sys.exit(1)

init_db()

if fetchone("SELECT id FROM profiles WHERE email = ?", (email,)):
    print(f"Account already exists for {email} — nothing to do.")
    sys.exit(0)

uid = new_id()
execute(
    "INSERT INTO profiles (id, email, name, role, approved, password_hash) VALUES (?,?,?,?,1,?)",
    (uid, email, "Admin", "admin", _pwd_ctx.hash(password)),
)
print(f"Admin account created: {email} (id={uid})")
