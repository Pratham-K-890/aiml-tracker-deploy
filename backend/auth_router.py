"""
Auth module — login + admin-only account management.

No self-registration. Admin creates all accounts directly via Supabase Admin API.

Endpoints:
  POST   /api/auth/login                     — email + password → JWT
  POST   /api/auth/admin/create-teacher      — create teacher / hod / admin account
  POST   /api/auth/admin/create-student      — create single student account
  POST   /api/auth/admin/preview-students    — parse xlsx, return rows (no DB changes)
  POST   /api/auth/admin/upload-students     — bulk-create students from xlsx
  DELETE /api/auth/admin/users/{user_id}     — delete an account
"""

from __future__ import annotations

import os
from io import BytesIO
from typing import Optional

import openpyxl
import requests
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from jwt_auth import verify_token, require_admin

router = APIRouter(prefix="/api/auth", tags=["auth"])

_RAW_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
_SUPA_BASE = _RAW_URL[: -len("/rest/v1")] if _RAW_URL.endswith("/rest/v1") else _RAW_URL
_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")


# ── Supabase Admin API helpers ────────────────────────────────────────────────

def _supa_create_user(email: str, password: str) -> str:
    """Create a confirmed Supabase auth user. Returns user UUID."""
    if not (_SUPA_BASE and _SERVICE_KEY):
        raise HTTPException(503, "Supabase credentials not configured.")
    res = requests.post(
        f"{_SUPA_BASE}/auth/v1/admin/users",
        json={"email": email, "password": password, "email_confirm": True},
        headers={
            "apikey": _SERVICE_KEY,
            "Authorization": f"Bearer {_SERVICE_KEY}",
            "Content-Type": "application/json",
        },
        timeout=10,
    )
    data = res.json()
    if not res.ok:
        msg = data.get("message") or data.get("msg") or str(data)
        if "already been registered" in msg or "already exists" in msg:
            raise HTTPException(409, "An account with this email already exists.")
        raise HTTPException(res.status_code, f"Could not create account: {msg}")
    return data["id"]


def _supa_delete_user(user_id: str) -> None:
    requests.delete(
        f"{_SUPA_BASE}/auth/v1/admin/users/{user_id}",
        headers={
            "apikey": _SERVICE_KEY,
            "Authorization": f"Bearer {_SERVICE_KEY}",
        },
        timeout=10,
    )


def _supa_login(email: str, password: str) -> dict:
    try:
        res = requests.post(
            f"{_SUPA_BASE}/auth/v1/token?grant_type=password",
            json={"email": email, "password": password},
            headers={"apikey": _SERVICE_KEY, "Content-Type": "application/json"},
            timeout=10,
        )
    except requests.exceptions.ConnectionError:
        raise HTTPException(503, "Cannot reach authentication server. The database project may be paused — check the Supabase dashboard.")
    except requests.exceptions.Timeout:
        raise HTTPException(504, "Authentication server timed out.")
    try:
        data = res.json()
    except Exception:
        raise HTTPException(502, f"Unexpected response from auth server (HTTP {res.status_code}).")
    if not res.ok:
        raise HTTPException(
            401,
            data.get("error_description") or data.get("msg") or "Invalid credentials.",
        )
    return data


# ── Schemas ───────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


class CreateTeacherRequest(BaseModel):
    name: str
    email: str
    password: str
    role: str  # 'teacher' | 'hod' | 'admin'


class CreateStudentRequest(BaseModel):
    name: str
    email: str
    password: str
    usn: Optional[str] = None


# ── Login ─────────────────────────────────────────────────────────────────────

@router.post("/login")
def login(body: LoginRequest):
    email = body.email.strip().lower()
    return _supa_login(email, body.password)


# ── Admin: create teacher / hod / admin account ───────────────────────────────

@router.post("/admin/create-teacher")
def create_teacher(body: CreateTeacherRequest, user: dict = Depends(verify_token)):
    from project_tracker import db
    require_admin(user)

    valid_roles = {"teacher", "hod", "admin"}
    if body.role not in valid_roles:
        raise HTTPException(400, f"Role must be one of: {', '.join(sorted(valid_roles))}")
    if len(body.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters.")

    email = body.email.strip().lower()
    user_id = _supa_create_user(email, body.password)
    try:
        db.table("profiles").insert({
            "id": user_id,
            "email": email,
            "name": body.name.strip(),
            "role": body.role,
            "approved": True,
        }).execute()
    except Exception as exc:
        _supa_delete_user(user_id)
        raise HTTPException(500, f"Profile setup failed: {exc}")

    return {"id": user_id, "email": email, "name": body.name.strip(), "role": body.role}


# ── Admin: create single student account ─────────────────────────────────────

@router.post("/admin/create-student")
def create_student(body: CreateStudentRequest, user: dict = Depends(verify_token)):
    from project_tracker import db
    require_admin(user)

    if len(body.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters.")

    email = body.email.strip().lower()
    usn = body.usn.strip().upper() if body.usn and body.usn.strip() else None
    user_id = _supa_create_user(email, body.password)
    try:
        db.table("profiles").insert({
            "id": user_id,
            "email": email,
            "name": body.name.strip() or None,
            "role": "student",
            "usn": usn,
            "approved": True,
        }).execute()
    except Exception as exc:
        _supa_delete_user(user_id)
        raise HTTPException(500, f"Profile setup failed: {exc}")

    return {"id": user_id, "email": email, "name": body.name, "usn": usn}


# ── Admin: preview xlsx (no DB writes) ───────────────────────────────────────

@router.post("/admin/preview-students")
async def preview_students(
    file: UploadFile = File(...),
    user: dict = Depends(verify_token),
):
    require_admin(user)

    if not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Only .xlsx files are accepted.")

    contents = await file.read()
    try:
        wb = openpyxl.load_workbook(BytesIO(contents), data_only=True)
    except Exception as exc:
        raise HTTPException(400, f"Could not parse file: {exc}")

    ws = wb.active
    preview = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not any(v is not None and str(v).strip() for v in row):
            continue
        cells = [str(v).strip() if v is not None else "" for v in row]
        while len(cells) < 5:
            cells.append("")
        sl_no, usn, name, email, password = cells[:5]
        preview.append({
            "sl_no": sl_no,
            "usn": usn,
            "name": name,
            "email": email,
            "password_set": bool(password),  # never expose the actual password
        })

    return {"count": len(preview), "rows": preview}


# ── Admin: bulk student upload ────────────────────────────────────────────────

@router.post("/admin/upload-students")
async def upload_students(
    file: UploadFile = File(...),
    user: dict = Depends(verify_token),
):
    from project_tracker import db
    require_admin(user)

    if not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Only .xlsx files are accepted.")

    contents = await file.read()
    try:
        wb = openpyxl.load_workbook(BytesIO(contents), data_only=True)
    except Exception as exc:
        raise HTTPException(400, f"Could not parse file: {exc}")

    ws = wb.active
    created, skipped, errors = [], [], []

    for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if not any(v is not None and str(v).strip() for v in row):
            continue

        cells = [str(v).strip() if v is not None else "" for v in row]
        while len(cells) < 5:
            cells.append("")
        _sl, usn, name, email, password = cells[:5]

        if not email or not password:
            errors.append({"row": i, "error": "Email and password are required"})
            continue
        if len(password) < 6:
            errors.append({"row": i, "email": email, "error": "Password must be at least 6 characters"})
            continue

        try:
            uid = _supa_create_user(email.lower(), password)
            db.table("profiles").insert({
                "id": uid,
                "email": email.lower(),
                "name": name or None,
                "role": "student",
                "usn": usn.upper() if usn else None,
                "approved": True,
            }).execute()
            created.append({"email": email, "name": name, "usn": usn})
        except HTTPException as e:
            if e.status_code == 409:
                skipped.append({"email": email, "reason": "already exists"})
            else:
                errors.append({"row": i, "email": email, "error": e.detail})
        except Exception as e:
            errors.append({"row": i, "email": email, "error": str(e)})

    return {
        "created": len(created),
        "skipped": len(skipped),
        "errors": errors,
        "accounts": created,
    }


# ── Admin: delete account ─────────────────────────────────────────────────────

@router.delete("/admin/users/{user_id}")
def delete_user(user_id: str, user: dict = Depends(verify_token)):
    from project_tracker import db
    require_admin(user)

    if user.get("sub") == user_id:
        raise HTTPException(400, "You cannot delete your own account.")

    db.table("profiles").delete().eq("id", user_id).execute()
    _supa_delete_user(user_id)
    return {"message": "Account deleted."}
