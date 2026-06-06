"""
JWT authentication + role-based access checks.

Role hierarchy: hod > admin > teacher (coordinator / guide) > student

  verify_token               — decode Supabase JWT, return payload
  require_admin              — hod or admin
  require_coordinator_for_course   — hod, admin, or coordinator of that course
  require_coordinator_for_project  — resolves course, then same check
  require_guide_for_project  — hod, admin, course coordinator, or project's guide

Supabase newer projects issue ES256 tokens (asymmetric).  We fetch the
public keys from the JWKS endpoint at startup and fall back to HS256
with the shared secret for legacy deployments.
"""

import json
import os

import jwt
import requests as _req
from fastapi import Header, HTTPException, status

_SUPA_URL_RAW = os.getenv("SUPABASE_URL", "").rstrip("/")
_SUPA_BASE = (
    _SUPA_URL_RAW[: -len("/rest/v1")]
    if _SUPA_URL_RAW.endswith("/rest/v1")
    else _SUPA_URL_RAW
)

_HS_SECRET: str = os.getenv("SUPABASE_JWT_SECRET", "")
_ELEVATED = frozenset({"hod", "admin"})


def _build_key_map() -> dict:
    """Fetch JWKS from Supabase and return {kid: (alg, public_key)}."""
    if not _SUPA_BASE:
        return {}
    try:
        res = _req.get(
            f"{_SUPA_BASE}/auth/v1/.well-known/jwks.json", timeout=10
        )
        res.raise_for_status()
        keys = res.json().get("keys", [])
    except Exception:
        return {}

    key_map: dict = {}
    for k in keys:
        try:
            alg = k.get("alg", "")
            kid = k.get("kid", "")
            if alg == "ES256":
                pub = jwt.algorithms.ECAlgorithm.from_jwk(json.dumps(k))
            elif alg == "RS256":
                pub = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(k))
            else:
                continue
            key_map[kid] = (alg, pub)
        except Exception:
            continue
    return key_map


_KEY_MAP: dict = _build_key_map()


def verify_token(authorization: str = Header(...)) -> dict:
    """Decode + verify a Supabase JWT. Raises 401 on missing/expired/invalid."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Authorization header must use the Bearer scheme.",
        )
    token = authorization[len("Bearer "):]

    try:
        header = jwt.get_unverified_header(token)
    except jwt.DecodeError as exc:
        raise HTTPException(401, f"Malformed token: {exc}")

    alg = header.get("alg", "")
    kid = header.get("kid", "")

    try:
        _opts = {"verify_aud": False, "verify_iat": False}
        if alg in ("ES256", "RS256") and kid in _KEY_MAP:
            _, pub_key = _KEY_MAP[kid]
            payload = jwt.decode(
                token,
                pub_key,
                algorithms=[alg],
                options=_opts,
            )
        elif alg == "HS256" and _HS_SECRET:
            payload = jwt.decode(
                token,
                _HS_SECRET,
                algorithms=["HS256"],
                options=_opts,
            )
        else:
            raise HTTPException(
                401,
                f"No key available to verify this token (alg={alg}, kid={kid}).",
            )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token has expired.")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(401, f"Invalid token: {exc}")


def _get_role(user_id: str) -> str:
    from project_tracker import db
    hit = db.table("profiles").select("role").eq("id", user_id).execute()
    if not hit.data:
        raise HTTPException(403, "Profile not found. Contact an admin.")
    return hit.data[0].get("role", "")


def require_admin(user: dict) -> None:
    """HOD and admin pass. All other roles raise 403."""
    uid = user.get("sub")
    if not uid:
        raise HTTPException(401, "Token has no subject claim.")
    if _get_role(uid) not in _ELEVATED:
        raise HTTPException(403, "Admin access required.")


def require_coordinator_for_course(course_id: str, user: dict) -> None:
    """HOD, admin, or the coordinator assigned to course_id pass."""
    from project_tracker import db
    uid = user.get("sub")
    if not uid:
        raise HTTPException(401, "Token has no subject claim.")
    if _get_role(uid) in _ELEVATED:
        return
    hit = (
        db.table("coordinator").select("course_id")
        .eq("user_id", uid).eq("course_id", course_id).execute()
    )
    if not hit.data:
        raise HTTPException(403, "Only the course coordinator may perform this action.")


def require_coordinator_for_project(project_id: str, user: dict) -> None:
    """Resolves course_id from project, then applies coordinator check."""
    from project_tracker import db
    uid = user.get("sub")
    if not uid:
        raise HTTPException(401, "Token has no subject claim.")
    if _get_role(uid) in _ELEVATED:
        return
    proj = db.table("project").select("course_id").eq("project_id", project_id).execute()
    if not proj.data:
        raise HTTPException(404, "Project not found.")
    course_id = proj.data[0]["course_id"]
    hit = (
        db.table("coordinator").select("course_id")
        .eq("user_id", uid).eq("course_id", course_id).execute()
    )
    if not hit.data:
        raise HTTPException(403, "Only the course coordinator may perform this action.")


def require_guide_for_project(project_id: str, user: dict) -> None:
    """HOD, admin, course coordinator, or the project's own guide pass."""
    from project_tracker import db
    uid = user.get("sub")
    if not uid:
        raise HTTPException(401, "Token has no subject claim.")
    if _get_role(uid) in _ELEVATED:
        return
    proj = (
        db.table("project").select("course_id, guide_id")
        .eq("project_id", project_id).execute()
    )
    if not proj.data:
        raise HTTPException(404, "Project not found.")
    if proj.data[0].get("guide_id") == uid:
        return
    course_id = proj.data[0]["course_id"]
    hit = (
        db.table("coordinator").select("course_id")
        .eq("user_id", uid).eq("course_id", course_id).execute()
    )
    if not hit.data:
        raise HTTPException(
            403, "Only the project guide or course coordinator may perform this action."
        )
