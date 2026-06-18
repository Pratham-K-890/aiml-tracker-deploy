"""
JWT authentication for Docker/SQLite deployment.
Uses HS256 with JWT_SECRET env var instead of Supabase JWKS.

Role hierarchy: hod > admin > teacher (coordinator / guide) > student
"""
from __future__ import annotations

import os

import jwt
from fastapi import Header, HTTPException, status

_SECRET: str = os.getenv("JWT_SECRET", "")
_ELEVATED = frozenset({"hod", "admin"})


def verify_token(authorization: str = Header(...)) -> dict:
    """Decode + verify a HS256 JWT. Raises 401 on missing/expired/invalid."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authorization header must use the Bearer scheme.")
    token = authorization[len("Bearer "):]
    if not _SECRET:
        raise HTTPException(500, "JWT_SECRET not configured on the server.")
    try:
        payload = jwt.decode(token, _SECRET, algorithms=["HS256"])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token has expired.")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token.")


def _get_role(user_id: str) -> str:
    from database import fetchone
    row = fetchone("SELECT role FROM profiles WHERE id = ?", (user_id,))
    if not row:
        raise HTTPException(403, "Profile not found. Contact an admin.")
    return row.get("role", "")


def require_admin(user: dict) -> None:
    """HOD and admin pass. All other roles raise 403."""
    uid = user.get("sub")
    if not uid:
        raise HTTPException(401, "Token has no subject claim.")
    if _get_role(uid) not in _ELEVATED:
        raise HTTPException(403, "Admin access required.")


def require_coordinator_for_course(course_id: str, user: dict) -> None:
    """HOD, admin, or the coordinator assigned to course_id pass."""
    from database import fetchone
    uid = user.get("sub")
    if not uid:
        raise HTTPException(401, "Token has no subject claim.")
    if _get_role(uid) in _ELEVATED:
        return
    hit = fetchone(
        "SELECT 1 FROM coordinator WHERE user_id = ? AND course_id = ?",
        (uid, course_id),
    )
    if not hit:
        raise HTTPException(403, "Only the course coordinator may perform this action.")


def require_coordinator_for_project(project_id: str, user: dict) -> None:
    """Resolves course_id from project, then applies coordinator check."""
    from database import fetchone
    uid = user.get("sub")
    if not uid:
        raise HTTPException(401, "Token has no subject claim.")
    if _get_role(uid) in _ELEVATED:
        return
    proj = fetchone("SELECT course_id FROM project WHERE project_id = ?", (project_id,))
    if not proj:
        raise HTTPException(404, "Project not found.")
    hit = fetchone(
        "SELECT 1 FROM coordinator WHERE user_id = ? AND course_id = ?",
        (uid, proj["course_id"]),
    )
    if not hit:
        raise HTTPException(403, "Only the course coordinator may perform this action.")


def require_guide_for_project(project_id: str, user: dict) -> None:
    """HOD, admin, course coordinator, or the project's own guide pass."""
    from database import fetchone
    uid = user.get("sub")
    if not uid:
        raise HTTPException(401, "Token has no subject claim.")
    if _get_role(uid) in _ELEVATED:
        return
    proj = fetchone("SELECT course_id, guide_id FROM project WHERE project_id = ?", (project_id,))
    if not proj:
        raise HTTPException(404, "Project not found.")
    if proj.get("guide_id") == uid:
        return
    hit = fetchone(
        "SELECT 1 FROM coordinator WHERE user_id = ? AND course_id = ?",
        (uid, proj["course_id"]),
    )
    if not hit:
        raise HTTPException(403, "Only the project guide or course coordinator may perform this action.")
