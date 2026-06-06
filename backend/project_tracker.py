"""
Project Tracker — domain API.

Route hierarchy:
    /batches                                   GET, POST
    /batches/{id}/semesters                    GET, POST
    /semesters/{id}/courses                    GET, POST
    /courses/{id}/coordinators                 GET, POST
    /courses/{id}/projects                     GET, POST  (legacy create)
    /courses/{id}/teams                        POST  (coordinator: manual team create with students)
    /courses/{id}/upload-excel                 POST  (coordinator: bulk team upload)
    /courses/{id}/download-course-template     GET
    /courses/{id}/is-coordinator               GET   ({is_coordinator: bool})
    /courses/{id}/my-guide-teams               GET
    /courses/{id}/my-exam-teams                GET
    /courses/{id}/reviews                      GET, POST
    /projects/{id}                             GET, PUT, DELETE
    /projects/{id}/guide                       PATCH  (assign/unassign guide)
    /projects/{id}/examiners                   POST   (add examiner, max 2)
    /projects/{id}/examiners/{user_id}         DELETE
    /projects/{id}/upload-excel                POST   (legacy per-project upload)
    /projects/{id}/readme                      GET
    /reviews/{id}                              PUT, DELETE
    /students/{id}                             PUT, DELETE
    /teachers                                  GET   (all teacher profiles for dropdowns)
    /download-template                         GET   (legacy per-project template)
"""

from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Optional

import openpyxl
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from pydantic import BaseModel
import httpx
from supabase import Client, create_client
from supabase.lib.client_options import SyncClientOptions

from jwt_auth import (
    verify_token,
    require_admin,
    require_coordinator_for_course,
    require_coordinator_for_project,
    require_guide_for_project,
)

# ── Supabase client ───────────────────────────────────────────────────────────
_URL = os.getenv("SUPABASE_URL", "")
_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
if not (_URL and _KEY):
    raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
db: Client = create_client(
    _URL, _KEY,
    options=SyncClientOptions(httpx_client=httpx.Client(http2=False)),
)

router = APIRouter(prefix="/api/tracker", tags=["project-tracker"])

# ── Template column definitions ───────────────────────────────────────────────
MAX_TEAM = 4
_TEAM_COLS: list[str] = []
for _i in range(1, MAX_TEAM + 1):
    _TEAM_COLS += [f"student_{_i}_usn", f"student_{_i}_name"]

TEMPLATE_COLUMNS: list[str] = ["project_title", "github_link", "guide_name", *_TEAM_COLS]

COURSE_TEMPLATE_COLUMNS: list[str] = [
    "team_no", "project_title", "github_url", "usn", "student_name",
]

_ELEVATED = frozenset({"hod", "admin"})


# ── Pydantic schemas ──────────────────────────────────────────────────────────
class BatchIn(BaseModel):
    batch_name: str
    year: Optional[int] = None


class SemesterIn(BaseModel):
    sem_number: int


class CourseIn(BaseModel):
    course_name: str
    course_code: Optional[str] = None


class ProjectIn(BaseModel):
    title: Optional[str] = None
    github: Optional[str] = None
    guide: Optional[str] = None
    team_number: Optional[int] = None


class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    github: Optional[str] = None
    guide: Optional[str] = None


class TeamIn(BaseModel):
    team_number: Optional[int] = None
    title: str
    github: Optional[str] = None
    students: Optional[list] = []


class StudentUpdate(BaseModel):
    usn: Optional[str] = None
    name: Optional[str] = None


class SemesterStatusIn(BaseModel):
    project_status: Optional[str] = None
    project_active: Optional[bool] = None


class ReviewIn(BaseModel):
    title: str
    date: str
    description: Optional[str] = None
    document_url: Optional[str] = None


class ReviewUpdate(BaseModel):
    title: Optional[str] = None
    date: Optional[str] = None
    description: Optional[str] = None
    document_url: Optional[str] = None


class CoordinatorIn(BaseModel):
    user_id: str


class AssignCoordinatorIn(BaseModel):
    user_id: str
    course_id: str


class GuideAssignIn(BaseModel):
    user_id: Optional[str] = None  # None to unassign


class ExaminerIn(BaseModel):
    user_id: str


_STUDENT_EMAIL_RE = re.compile(r"^[a-zA-Z0-9]+@dsce\.edu\.in$", re.IGNORECASE)

# ── Evaluation rubric (static — same for all courses) ────────────────────────
REVIEW_META: dict = {
    1: {
        "phase": "Problem & Design Phase",
        "max_each": 10,
        "max_total": 50,
        "criteria": [
            "Problem Definition",
            "Literature Survey",
            "Proposed Solution",
            "Methodology Understanding",
            "Team Work & Presentation (Q&A)",
        ],
    },
    2: {
        "phase": "Implementation Phase",
        "max_each": 10,
        "max_total": 50,
        "criteria": [
            "Implementation Progress",
            "Methodology Application",
            "Verification & Validation",
            "Project Management",
            "Team Work & Presentation (Q&A)",
        ],
    },
    3: {
        "phase": "Demonstration Phase",
        "max_each": 25,
        "max_total": 100,
        "criteria": [
            "Effective Demonstration",
            "Test Case Coverage",
            "Completeness of Project as per Set Objectives",
            "Team Work & Presentation (Q&A)",
        ],
    },
}


class EvalLockIn(BaseModel):
    is_locked: bool


class EvalMarkIn(BaseModel):
    student_id: str
    c1: Optional[int] = None
    c2: Optional[int] = None
    c3: Optional[int] = None
    c4: Optional[int] = None
    c5: Optional[int] = None


def _is_student_email(email: str) -> bool:
    return bool(_STUDENT_EMAIL_RE.match(email or ""))


def _create_eval_reviews(course_id: str) -> None:
    rows = [{"course_id": course_id, "review_number": n, "is_locked": True} for n in (1, 2, 3)]
    db.table("evaluation_review").upsert(rows, on_conflict="course_id,review_number").execute()


# ── Helpers ───────────────────────────────────────────────────────────────────
def _str(v: Any) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _enrich_guides(projects: list[dict]) -> None:
    guide_ids = list({p["guide_id"] for p in projects if p.get("guide_id")})
    if not guide_ids:
        for p in projects:
            p["guide_profile"] = None
        return
    profiles = (
        db.table("profiles").select("id, name, email")
        .in_("id", guide_ids).execute().data or []
    )
    pm = {p["id"]: p for p in profiles}
    for proj in projects:
        gid = proj.get("guide_id")
        proj["guide_profile"] = pm.get(gid) if gid else None


def _enrich_examiners(projects: list[dict]) -> None:
    project_ids = [p["project_id"] for p in projects]
    if not project_ids:
        for p in projects:
            p["examiners"] = []
        return
    rows = (
        db.table("project_examiner").select("project_id, user_id")
        .in_("project_id", project_ids).execute().data or []
    )
    user_ids = list({r["user_id"] for r in rows})
    prof_map: dict = {}
    if user_ids:
        profs = (
            db.table("profiles").select("id, name, email")
            .in_("id", user_ids).execute().data or []
        )
        prof_map = {p["id"]: p for p in profs}
    by_project: dict = {}
    for r in rows:
        pid = r["project_id"]
        prof = prof_map.get(r["user_id"], {})
        by_project.setdefault(pid, []).append({
            "user_id": r["user_id"],
            "name": prof.get("name"),
            "email": prof.get("email"),
        })
    for p in projects:
        p["examiners"] = by_project.get(p["project_id"], [])


def _course_id_for_project(project_id: str) -> str:
    p = db.table("project").select("course_id").eq("project_id", project_id).execute()
    if not p.data:
        raise HTTPException(404, "Project not found.")
    return p.data[0]["course_id"]


# ─────────────────────────────────────────────────────────────────────────────
# Read endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/batches")
def list_batches(_user=Depends(verify_token)):
    return (
        db.table("batch")
        .select("batch_id, batch_name, year, semester(project_status, project_active)")
        .order("year", desc=True).execute().data
    )


@router.delete("/batches/{batch_id}")
def delete_batch(batch_id: str, user=Depends(verify_token)):
    require_admin(user)
    res = db.table("batch").delete().eq("batch_id", batch_id).execute()
    if not res.data:
        raise HTTPException(404, "Batch not found.")
    return {"message": "Batch deleted."}


@router.get("/batches/{batch_id}/semesters")
def list_semesters(batch_id: str, _user=Depends(verify_token)):
    return (
        db.table("semester").select("*")
        .eq("batch_id", batch_id).order("sem_number").execute().data
    )


@router.get("/me")
def get_me(user: dict = Depends(verify_token)):
    uid = user.get("sub")
    prof = db.table("profiles").select("*").eq("id", uid).execute()
    if not prof.data:
        raise HTTPException(404, "Profile not found. Contact an admin to set up your account.")
    return prof.data[0]


@router.get("/teachers")
def list_teachers(_user=Depends(verify_token)):
    """All approved teacher/hod/admin profiles for guide and examiner dropdowns."""
    return (
        db.table("profiles").select("id, name, email, role")
        .in_("role", ["teacher", "hod", "admin"])
        .eq("approved", True)
        .order("name")
        .execute().data or []
    )


@router.patch("/semesters/{semester_id}/status")
def update_semester_status(semester_id: str, body: SemesterStatusIn, user=Depends(verify_token)):
    uid = user.get("sub")
    if not uid:
        raise HTTPException(401, "No subject claim in token.")
    role_row = db.table("profiles").select("role").eq("id", uid).execute()
    user_role = role_row.data[0].get("role", "") if role_row.data else ""
    if user_role not in _ELEVATED:
        courses = db.table("course").select("course_id").eq("semester_id", semester_id).execute()
        if not courses.data:
            raise HTTPException(403, "Not authorized.")
        course_ids = [c["course_id"] for c in courses.data]
        hit = (
            db.table("coordinator").select("course_id")
            .eq("user_id", uid).in_("course_id", course_ids).execute()
        )
        if not hit.data:
            raise HTTPException(403, "Only a course coordinator or admin may update semester status.")
    if body.project_status not in (None, "mini", "major"):
        raise HTTPException(400, "project_status must be 'mini', 'major', or null.")
    patch: dict = {"project_status": body.project_status}
    if body.project_status is None:
        patch["project_active"] = False
    elif body.project_active is not None:
        patch["project_active"] = body.project_active
    res = db.table("semester").update(patch).eq("semester_id", semester_id).execute()
    if not res.data:
        raise HTTPException(404, "Semester not found.")
    return res.data[0]


@router.delete("/semesters/{semester_id}/projects")
def clear_semester_projects(semester_id: str, user=Depends(verify_token)):
    require_admin(user)
    courses = db.table("course").select("course_id").eq("semester_id", semester_id).execute()
    if not courses.data:
        return {"deleted": 0}
    course_ids = [c["course_id"] for c in courses.data]
    res = db.table("project").delete().in_("course_id", course_ids).execute()
    return {"deleted": len(res.data) if res.data else 0}


@router.delete("/semesters/{semester_id}")
def delete_semester(semester_id: str, user=Depends(verify_token)):
    require_admin(user)
    res = db.table("semester").delete().eq("semester_id", semester_id).execute()
    if not res.data:
        raise HTTPException(404, "Semester not found.")
    return {"message": "Semester deleted."}


@router.get("/semesters/{semester_id}/courses")
def list_courses(semester_id: str, _user=Depends(verify_token)):
    return (
        db.table("course")
        .select("course_id, course_name, course_code, semester_id")
        .eq("semester_id", semester_id).order("course_name").execute().data
    )


@router.delete("/courses/{course_id}")
def delete_course(course_id: str, user=Depends(verify_token)):
    require_admin(user)
    res = db.table("course").delete().eq("course_id", course_id).execute()
    if not res.data:
        raise HTTPException(404, "Course not found.")
    return {"message": "Course deleted."}


@router.get("/courses/{course_id}/is-coordinator")
def is_coordinator_check(course_id: str, user=Depends(verify_token)):
    uid = user.get("sub")
    if not uid:
        return {"is_coordinator": False}
    prof = db.table("profiles").select("role").eq("id", uid).execute()
    role = prof.data[0].get("role", "") if prof.data else ""
    if role in _ELEVATED:
        return {"is_coordinator": True}
    hit = (
        db.table("coordinator").select("course_id")
        .eq("user_id", uid).eq("course_id", course_id).execute()
    )
    return {"is_coordinator": bool(hit.data)}


@router.get("/courses/{course_id}/projects")
def list_projects(course_id: str, _user=Depends(verify_token)):
    projects = (
        db.table("project")
        .select("project_id, title, github, guide, guide_id, team_number, students:student(student_id, usn, name)")
        .eq("course_id", course_id)
        .order("team_number", nullsfirst=False)
        .execute().data
    ) or []
    _enrich_guides(projects)
    _enrich_examiners(projects)
    return projects


@router.get("/courses/{course_id}/my-guide-teams")
def my_guide_teams(course_id: str, user=Depends(verify_token)):
    uid = user.get("sub")
    projects = (
        db.table("project")
        .select("project_id, title, github, guide, guide_id, team_number, students:student(student_id, usn, name)")
        .eq("course_id", course_id).eq("guide_id", uid)
        .order("team_number", nullsfirst=False).execute().data
    ) or []
    _enrich_guides(projects)
    _enrich_examiners(projects)
    return projects


@router.get("/courses/{course_id}/my-exam-teams")
def my_exam_teams(course_id: str, user=Depends(verify_token)):
    uid = user.get("sub")
    exam_rows = (
        db.table("project_examiner").select("project_id")
        .eq("user_id", uid).execute().data or []
    )
    project_ids = [r["project_id"] for r in exam_rows]
    if not project_ids:
        return []
    projects = (
        db.table("project")
        .select("project_id, title, github, guide, guide_id, team_number, students:student(student_id, usn, name)")
        .eq("course_id", course_id).in_("project_id", project_ids)
        .order("team_number", nullsfirst=False).execute().data
    ) or []
    _enrich_guides(projects)
    _enrich_examiners(projects)
    return projects


@router.get("/projects/{project_id}")
def get_project(project_id: str, _user=Depends(verify_token)):
    res = (
        db.table("project")
        .select(
            "project_id, title, github, guide, guide_id, team_number, course_id, "
            "students:student(student_id, usn, name), "
            "course(course_id, course_name, semester_id, "
            "semester(semester_id, sem_number, batch_id, "
            "batch(batch_id, batch_name, year)))"
        )
        .eq("project_id", project_id).execute()
    )
    if not res.data:
        raise HTTPException(404, "Project not found.")
    p = res.data[0]
    _enrich_guides([p])
    _enrich_examiners([p])
    return p


# ─────────────────────────────────────────────────────────────────────────────
# Write endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/batches")
def create_batch(body: BatchIn, _user=Depends(verify_token)):
    try:
        res = db.table("batch").insert(body.model_dump()).execute()
        if not res.data:
            raise HTTPException(500, "Batch insert returned no data.")
        return res.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, str(exc))


@router.post("/batches/{batch_id}/semesters")
def create_semester(batch_id: str, body: SemesterIn, _user=Depends(verify_token)):
    existing = (
        db.table("semester").select("*")
        .eq("batch_id", batch_id).eq("sem_number", body.sem_number).execute()
    )
    if existing.data:
        return existing.data[0]
    try:
        res = db.table("semester").insert({"batch_id": batch_id, **body.model_dump()}).execute()
        if not res.data:
            raise HTTPException(500, "Semester insert returned no data.")
        return res.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, str(exc))


@router.post("/semesters/{semester_id}/courses")
def create_course(semester_id: str, body: CourseIn, _user=Depends(verify_token)):
    payload = {"semester_id": semester_id, **{k: v for k, v in body.model_dump().items() if v is not None}}
    try:
        res = db.table("course").insert(payload).execute()
        if not res.data:
            raise HTTPException(500, "Course insert returned no data.")
        _create_eval_reviews(res.data[0]["course_id"])
        return res.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, str(exc))


@router.post("/courses/{course_id}/coordinators")
def add_coordinator(course_id: str, body: CoordinatorIn, _user=Depends(verify_token)):
    return db.table("coordinator").upsert(
        {"user_id": body.user_id, "course_id": course_id}
    ).execute().data[0]


@router.get("/courses/{course_id}/coordinators")
def list_coordinators(course_id: str, _user=Depends(verify_token)):
    return db.table("coordinator").select("*").eq("course_id", course_id).execute().data


@router.post("/courses/{course_id}/projects")
def create_project(course_id: str, body: ProjectIn, user=Depends(verify_token)):
    uid = user.get("sub")
    prof = db.table("profiles").select("role").eq("id", uid).execute()
    if not prof.data or prof.data[0].get("role") == "student":
        raise HTTPException(403, "Students cannot create projects.")
    payload = {
        "course_id": course_id,
        **{k: v for k, v in body.model_dump().items() if v is not None},
    }
    return db.table("project").insert(payload).execute().data[0]


@router.post("/courses/{course_id}/teams")
def create_team(course_id: str, body: TeamIn, user=Depends(verify_token)):
    """Coordinator: manually create a team with optional students in one call."""
    require_coordinator_for_course(course_id, user)
    payload: dict = {"course_id": course_id, "title": body.title}
    if body.team_number is not None:
        payload["team_number"] = body.team_number
    if body.github:
        payload["github"] = body.github
    res = db.table("project").insert(payload).execute()
    if not res.data:
        raise HTTPException(500, "Insert failed.")
    project_id = res.data[0]["project_id"]
    if body.students:
        rows = [
            {"project_id": project_id, "usn": s["usn"], "name": s["name"]}
            for s in body.students
            if isinstance(s, dict) and s.get("usn") and s.get("name")
        ]
        if rows:
            db.table("student").insert(rows).execute()
    result = (
        db.table("project")
        .select("project_id, title, github, guide_id, team_number, students:student(student_id, usn, name)")
        .eq("project_id", project_id).execute().data[0]
    )
    result["guide_profile"] = None
    result["examiners"] = []
    return result


@router.put("/projects/{project_id}")
def update_project(project_id: str, body: ProjectUpdate, user=Depends(verify_token)):
    require_guide_for_project(project_id, user)
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(400, "No fields provided.")
    res = db.table("project").update(patch).eq("project_id", project_id).execute()
    if not res.data:
        raise HTTPException(404, "Project not found.")
    return res.data[0]


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, user=Depends(verify_token)):
    require_guide_for_project(project_id, user)
    res = db.table("project").delete().eq("project_id", project_id).execute()
    if not res.data:
        raise HTTPException(404, "Project not found.")
    return {"message": "Project deleted."}


@router.patch("/projects/{project_id}/guide")
def assign_guide(project_id: str, body: GuideAssignIn, user=Depends(verify_token)):
    require_coordinator_for_project(project_id, user)
    res = db.table("project").update({"guide_id": body.user_id}).eq("project_id", project_id).execute()
    if not res.data:
        raise HTTPException(404, "Project not found.")
    return res.data[0]


@router.post("/projects/{project_id}/examiners")
def add_examiner(project_id: str, body: ExaminerIn, user=Depends(verify_token)):
    require_coordinator_for_project(project_id, user)
    existing = (
        db.table("project_examiner").select("id")
        .eq("project_id", project_id).execute().data or []
    )
    if len(existing) >= 2:
        raise HTTPException(400, "Maximum 2 examiners allowed per project.")
    try:
        res = db.table("project_examiner").insert(
            {"project_id": project_id, "user_id": body.user_id}
        ).execute()
        return res.data[0]
    except Exception as exc:
        raise HTTPException(400, str(exc))


@router.delete("/projects/{project_id}/examiners/{user_id}")
def remove_examiner(project_id: str, user_id: str, user=Depends(verify_token)):
    require_coordinator_for_project(project_id, user)
    db.table("project_examiner").delete().eq("project_id", project_id).eq("user_id", user_id).execute()
    return {"message": "Examiner removed."}


@router.put("/students/{student_id}")
def update_student(student_id: str, body: StudentUpdate, user=Depends(verify_token)):
    s = db.table("student").select("project_id").eq("student_id", student_id).execute()
    if not s.data:
        raise HTTPException(404, "Student not found.")
    require_guide_for_project(s.data[0]["project_id"], user)
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(400, "No fields provided.")
    res = db.table("student").update(patch).eq("student_id", student_id).execute()
    return res.data[0]


@router.delete("/students/{student_id}")
def delete_student(student_id: str, user=Depends(verify_token)):
    s = db.table("student").select("project_id").eq("student_id", student_id).execute()
    if not s.data:
        raise HTTPException(404, "Student not found.")
    require_guide_for_project(s.data[0]["project_id"], user)
    db.table("student").delete().eq("student_id", student_id).execute()
    return {"message": "Student deleted."}


# ─────────────────────────────────────────────────────────────────────────────
# Reviews
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/courses/{course_id}/reviews")
def list_reviews(course_id: str, _user=Depends(verify_token)):
    return (
        db.table("review").select("*")
        .eq("course_id", course_id).order("date").execute().data
    ) or []


@router.post("/courses/{course_id}/reviews")
def create_review(course_id: str, body: ReviewIn, user=Depends(verify_token)):
    require_coordinator_for_course(course_id, user)
    uid = user.get("sub")
    payload = {
        "course_id": course_id,
        "scheduled_by": uid,
        "title": body.title,
        "date": body.date,
        "description": body.description,
        "document_url": body.document_url,
    }
    return db.table("review").insert(payload).execute().data[0]


@router.put("/reviews/{review_id}")
def update_review(review_id: str, body: ReviewUpdate, user=Depends(verify_token)):
    rev = db.table("review").select("course_id").eq("review_id", review_id).execute()
    if not rev.data:
        raise HTTPException(404, "Review not found.")
    require_coordinator_for_course(rev.data[0]["course_id"], user)
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(400, "No fields provided.")
    return db.table("review").update(patch).eq("review_id", review_id).execute().data[0]


@router.delete("/reviews/{review_id}")
def delete_review(review_id: str, user=Depends(verify_token)):
    rev = db.table("review").select("course_id").eq("review_id", review_id).execute()
    if not rev.data:
        raise HTTPException(404, "Review not found.")
    require_coordinator_for_course(rev.data[0]["course_id"], user)
    db.table("review").delete().eq("review_id", review_id).execute()
    return {"message": "Review deleted."}


# ─────────────────────────────────────────────────────────────────────────────
# Course-level Excel upload — bulk creates/upserts teams
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/courses/{course_id}/upload-excel")
async def upload_course_excel(
    course_id: str,
    file: UploadFile = File(...),
    user=Depends(verify_token),
):
    require_coordinator_for_course(course_id, user)
    if not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Only .xlsx files are accepted.")
    contents = await file.read()
    try:
        wb = openpyxl.load_workbook(BytesIO(contents), data_only=True)
    except Exception as exc:
        raise HTTPException(400, f"Could not parse the file ({exc}).")
    ws = wb.active

    header = [
        str(c.value).strip().lower().replace(" ", "_") if c.value is not None else ""
        for c in ws[1]
    ]
    expected = [col.lower() for col in COURSE_TEMPLATE_COLUMNS]
    for idx, (got, want) in enumerate(zip(header[:len(expected)], expected), start=1):
        if got != want:
            raise HTTPException(
                400,
                f"Column {idx} must be '{COURSE_TEMPLATE_COLUMNS[idx - 1]}' "
                f"but got '{ws[1][idx - 1].value}'. Re-download the template.",
            )

    # Parse rows with fill-down for team-level fields
    data_rows = list(ws.iter_rows(min_row=2, values_only=True))
    teams: dict = {}
    team_order: list = []
    current_no: Optional[str] = None

    for row in data_rows:
        if len(row) < 5:
            continue
        team_no_val = _str(row[0])
        title_val   = _str(row[1])
        github_val  = _str(row[2])
        usn_val     = _str(row[3])
        name_val    = _str(row[4])

        if team_no_val:
            current_no = team_no_val
            if current_no not in teams:
                try:
                    team_num: Optional[int] = int(team_no_val)
                except ValueError:
                    team_num = None
                teams[current_no] = {
                    "title": title_val or f"Team {team_no_val}",
                    "github": github_val,
                    "team_number": team_num,
                    "students": [],
                }
                team_order.append(current_no)
            else:
                if title_val:
                    teams[current_no]["title"] = title_val
                if github_val:
                    teams[current_no]["github"] = github_val

        if current_no and usn_val and name_val:
            teams[current_no]["students"].append({"usn": usn_val, "name": name_val})

    filled = [t for t in teams.values() if t["students"]]
    if not filled:
        raise HTTPException(400, "No teams with students found. Fill in at least one team's USN and name.")

    created = updated = total_students = 0

    for team_no_str in team_order:
        t = teams[team_no_str]
        if not t["students"]:
            continue  # skip blank team slots
        team_num = t["team_number"]
        existing_id: Optional[str] = None

        if team_num is not None:
            ex = (
                db.table("project").select("project_id")
                .eq("course_id", course_id).eq("team_number", team_num).execute()
            )
            if ex.data:
                existing_id = ex.data[0]["project_id"]

        if existing_id:
            db.table("project").update({"title": t["title"], "github": t["github"]}).eq("project_id", existing_id).execute()
            project_id = existing_id
            updated += 1
        else:
            payload: dict = {"course_id": course_id, "title": t["title"]}
            if team_num is not None:
                payload["team_number"] = team_num
            if t["github"]:
                payload["github"] = t["github"]
            res = db.table("project").insert(payload).execute()
            project_id = res.data[0]["project_id"]
            created += 1

        db.table("student").delete().eq("project_id", project_id).execute()
        if t["students"]:
            student_rows = [{"project_id": project_id, "usn": s["usn"], "name": s["name"]} for s in t["students"]]
            db.table("student").insert(student_rows).execute()
            total_students += len(student_rows)

    return {"teams_created": created, "teams_updated": updated, "students_inserted": total_students}


# ─────────────────────────────────────────────────────────────────────────────
# Course-level template download
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/courses/{course_id}/download-course-template")
def download_course_template(course_id: str, _user=Depends(verify_token)):
    wb = Workbook()
    ws = wb.active
    ws.title = "Teams"

    hdr_fill = PatternFill(start_color="0D1B2A", end_color="0D1B2A", fill_type="solid")
    hdr_font = Font(color="F5A623", bold=True)

    ws.append(COURSE_TEMPLATE_COLUMNS)
    for cell in ws[1]:
        cell.font = hdr_font
        cell.fill = hdr_fill
        cell.alignment = Alignment(horizontal="center")

    # 20 team slots × 4 student rows each — coordinator fills only what they need
    for team_num in range(1, 21):
        ws.append([team_num, "", "", "", ""])
        for _ in range(3):
            ws.append(["", "", "", "", ""])

    for col in ws.columns:
        width = max(len(str(c.value or "")) for c in col)
        ws.column_dimensions[col[0].column_letter].width = max(width + 4, 18)

    iws = wb.create_sheet("Instructions")
    iws.append(["Column", "Required?", "Notes"])
    for cell in iws[1]:
        cell.font = Font(bold=True)
    for row in [
        ("team_no",       "Yes (first row of team)", "Integer. Leave blank on subsequent student rows for the same team."),
        ("project_title", "Yes (first row of team)", "Defaults to 'Team N' if blank."),
        ("github_url",    "Optional",                "Leave empty — can be added later inside the project."),
        ("usn",           "Yes",                     "Student USN e.g. 4NM22AI001"),
        ("student_name",  "Yes",                     "Student full name"),
        ("",              "",                        "Re-download this template before uploading — headers are validated strictly."),
    ]:
        iws.append(row)
    for col in iws.columns:
        width = max(len(str(c.value or "")) for c in col)
        iws.column_dimensions[col[0].column_letter].width = max(width + 4, 20)

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=course_teams_template.xlsx"},
    )


# ─────────────────────────────────────────────────────────────────────────────
# Legacy per-project XLSX upload (kept for backward compat)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/upload-excel")
async def upload_project_excel(
    project_id: str,
    file: UploadFile = File(...),
    user=Depends(verify_token),
):
    require_guide_for_project(project_id, user)
    if not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Only .xlsx files are accepted.")
    contents = await file.read()
    try:
        wb = openpyxl.load_workbook(BytesIO(contents), data_only=True)
    except Exception as exc:
        raise HTTPException(400, f"Could not parse the file ({exc}).")
    ws = wb.active
    header = [str(c.value).strip() if c.value is not None else "" for c in ws[1]]
    if len(header) != len(TEMPLATE_COLUMNS):
        raise HTTPException(400, f"Header has {len(header)} columns; expected {len(TEMPLATE_COLUMNS)}. Re-download the template.")
    for idx, (got, want) in enumerate(zip(header, TEMPLATE_COLUMNS), start=1):
        if got != want:
            raise HTTPException(400, f"Column {idx} must be '{want}' but got '{got}'. Re-download the template.")
    data_rows = list(ws.iter_rows(min_row=2, values_only=True))
    row = next((r for r in data_rows if any(v is not None and str(v).strip() != "" for v in r)), None)
    if row is None:
        raise HTTPException(400, "Sheet has no data rows.")
    cells = dict(zip(TEMPLATE_COLUMNS, row))
    proj_patch = {
        k: _str(cells.get(src))
        for k, src in [("title", "project_title"), ("github", "github_link"), ("guide", "guide_name")]
        if _str(cells.get(src)) is not None
    }
    if proj_patch:
        db.table("project").update(proj_patch).eq("project_id", project_id).execute()
    db.table("student").delete().eq("project_id", project_id).execute()
    new_students: list[dict] = []
    skipped_slots: list[int] = []
    for i in range(1, MAX_TEAM + 1):
        usn = _str(cells.get(f"student_{i}_usn"))
        name = _str(cells.get(f"student_{i}_name"))
        if usn and name:
            new_students.append({"project_id": project_id, "usn": usn, "name": name})
        elif usn or name:
            skipped_slots.append(i)
    inserted = 0
    if new_students:
        ins = db.table("student").insert(new_students).execute()
        inserted = len(ins.data or [])
    return {
        "project": db.table("project").select("*").eq("project_id", project_id).execute().data[0],
        "students_inserted": inserted,
        "partial_slots_skipped": len(skipped_slots),
        "applied_project_fields": list(proj_patch.keys()),
    }


@router.get("/download-template")
def download_template():
    wb = Workbook()
    ws = wb.active
    ws.title = "Template"
    hdr_fill = PatternFill(start_color="0D1B2A", end_color="0D1B2A", fill_type="solid")
    hdr_font = Font(color="F5A623", bold=True)
    ws.append(TEMPLATE_COLUMNS)
    for cell in ws[1]:
        cell.font = hdr_font
        cell.fill = hdr_fill
        cell.alignment = Alignment(horizontal="center")
    ws.append(["Image Classifier", "https://github.com/team/ml-proj", "Dr. Smith",
                "1CS21AI001", "Alice Kumar", "1CS21AI002", "Bob Nair", "1CS21AI003", "Carol Menon", "", ""])
    for col in ws.columns:
        width = max(len(str(c.value or "")) for c in col)
        ws.column_dimensions[col[0].column_letter].width = max(width + 4, 16)
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=project_template.xlsx"},
    )


# ─────────────────────────────────────────────────────────────────────────────
# README passthrough
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/readme")
def get_project_readme(project_id: str, _user=Depends(verify_token)):
    from github_utils import parse_repo_url, fetch_readme
    proj = db.table("project").select("github").eq("project_id", project_id).execute()
    if not proj.data:
        raise HTTPException(404, "Project not found.")
    parsed = parse_repo_url(proj.data[0].get("github"))
    if not parsed:
        return {"found": False, "content": "", "reason": "no-github-link"}
    content = fetch_readme(*parsed)
    if not content:
        return {"found": False, "content": "", "reason": "private-or-missing"}
    return {"found": True, "content": content}


# ─────────────────────────────────────────────────────────────────────────────
# Admin endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/admin/users")
def admin_list_users(user: dict = Depends(verify_token)):
    require_admin(user)
    return (
        db.table("profiles").select("*")
        .in_("role", ["teacher", "hod", "student"]).order("email").execute().data
    )


@router.get("/admin/courses")
def admin_list_all_courses(user: dict = Depends(verify_token)):
    require_admin(user)
    return db.table("course").select(
        "course_id, course_name, course_code, semester(sem_number, batch(batch_name))"
    ).execute().data


@router.get("/admin/coordinators")
def admin_list_all_coordinators(user: dict = Depends(verify_token)):
    require_admin(user)
    coords = db.table("coordinator").select("*").execute().data or []
    all_profiles = db.table("profiles").select("id, email, role").execute().data or []
    pm = {p["id"]: p for p in all_profiles}
    all_courses = db.table("course").select("course_id, course_name, course_code").execute().data or []
    cm = {c["course_id"]: c for c in all_courses}
    for c in coords:
        c["email"] = pm.get(c["user_id"], {}).get("email", "")
        course = cm.get(c["course_id"], {})
        c["course_name"] = course.get("course_name", "")
        c["course_code"] = course.get("course_code", "")
    return coords


@router.post("/admin/assign-coordinator")
def admin_assign_coordinator(body: AssignCoordinatorIn, user: dict = Depends(verify_token)):
    require_admin(user)
    return db.table("coordinator").upsert(
        {"user_id": body.user_id, "course_id": body.course_id}
    ).execute().data[0]


@router.delete("/admin/coordinators/{course_id}/{user_id}")
def admin_remove_coordinator(course_id: str, user_id: str, user: dict = Depends(verify_token)):
    require_admin(user)
    db.table("coordinator").delete().eq("course_id", course_id).eq("user_id", user_id).execute()
    return {"message": "Coordinator removed."}


# ─────────────────────────────────────────────────────────────────────────────
# Evaluation reviews + marks
# ─────────────────────────────────────────────────────────────────────────────

def _enrich_eval_meta(rows: list[dict]) -> None:
    for r in rows:
        meta = REVIEW_META.get(r["review_number"], {})
        r["phase"]     = meta.get("phase", "")
        r["max_total"] = meta.get("max_total", 0)
        r["max_each"]  = meta.get("max_each", 10)
        r["criteria"]  = meta.get("criteria", [])


@router.get("/courses/{course_id}/evaluation-reviews")
def list_eval_reviews(course_id: str, _user=Depends(verify_token)):
    rows = (
        db.table("evaluation_review").select("*")
        .eq("course_id", course_id).order("review_number").execute().data or []
    )
    _enrich_eval_meta(rows)
    return rows


@router.patch("/evaluation-reviews/{eval_review_id}/lock")
def toggle_eval_review_lock(eval_review_id: str, body: EvalLockIn, user=Depends(verify_token)):
    rev = db.table("evaluation_review").select("course_id").eq("id", eval_review_id).execute()
    if not rev.data:
        raise HTTPException(404, "Evaluation review not found.")
    require_coordinator_for_course(rev.data[0]["course_id"], user)
    res = (
        db.table("evaluation_review")
        .update({"is_locked": body.is_locked})
        .eq("id", eval_review_id).execute()
    )
    return res.data[0]


@router.get("/evaluation-reviews/{eval_review_id}/my-marks/{project_id}")
def get_my_eval_marks(eval_review_id: str, project_id: str, user=Depends(verify_token)):
    uid = user.get("sub")
    if not uid:
        raise HTTPException(401, "No subject claim.")
    rows = (
        db.table("evaluation_mark")
        .select("student_id, scorer_type, c1, c2, c3, c4, c5")
        .eq("eval_review_id", eval_review_id)
        .eq("project_id", project_id)
        .eq("scorer_id", uid)
        .execute().data or []
    )
    return rows


@router.post("/evaluation-reviews/{eval_review_id}/marks/{project_id}")
def submit_eval_marks(
    eval_review_id: str,
    project_id: str,
    body: list[EvalMarkIn],
    user=Depends(verify_token),
):
    uid = user.get("sub")
    if not uid:
        raise HTTPException(401, "No subject claim.")

    rev = (
        db.table("evaluation_review")
        .select("is_locked, review_number")
        .eq("id", eval_review_id).execute()
    )
    if not rev.data:
        raise HTTPException(404, "Evaluation review not found.")
    if rev.data[0]["is_locked"]:
        raise HTTPException(403, "This review is locked. Ask the coordinator to unlock it.")

    proj = (
        db.table("project").select("guide_id")
        .eq("project_id", project_id).execute()
    )
    if not proj.data:
        raise HTTPException(404, "Project not found.")

    is_guide = proj.data[0].get("guide_id") == uid
    is_examiner = bool(
        db.table("project_examiner").select("id")
        .eq("project_id", project_id).eq("user_id", uid).execute().data
    )
    if not is_guide and not is_examiner:
        raise HTTPException(403, "You are not assigned as guide or examiner for this project.")

    scorer_type = "guide" if is_guide else "evaluator"

    meta = REVIEW_META.get(rev.data[0]["review_number"], {})
    max_each    = meta.get("max_each", 10)
    num_criteria = len(meta.get("criteria", []))
    now_ts = datetime.now(timezone.utc).isoformat()

    for entry in body:
        marks = [entry.c1, entry.c2, entry.c3, entry.c4, entry.c5]
        for i, m in enumerate(marks[:num_criteria]):
            if m is not None and not (0 <= m <= max_each):
                raise HTTPException(400, f"Criterion {i + 1} must be 0–{max_each}.")

        db.table("evaluation_mark").upsert(
            {
                "eval_review_id": eval_review_id,
                "project_id":     project_id,
                "student_id":     entry.student_id,
                "scorer_id":      uid,
                "scorer_type":    scorer_type,
                "c1": entry.c1,
                "c2": entry.c2,
                "c3": entry.c3,
                "c4": entry.c4,
                "c5": entry.c5,
                "submitted_at":   now_ts,
            },
            on_conflict="eval_review_id,student_id,scorer_id,scorer_type",
        ).execute()

    return {"submitted": len(body), "scorer_type": scorer_type}


@router.get("/evaluation-reviews/{eval_review_id}/summary")
def get_eval_review_summary(eval_review_id: str, user=Depends(verify_token)):
    uid = user.get("sub")
    if not uid:
        raise HTTPException(401, "No subject claim.")

    rev = db.table("evaluation_review").select("course_id, review_number").eq("id", eval_review_id).execute()
    if not rev.data:
        raise HTTPException(404, "Evaluation review not found.")
    course_id    = rev.data[0]["course_id"]
    review_number = rev.data[0]["review_number"]

    prof = db.table("profiles").select("role").eq("id", uid).execute()
    role = prof.data[0].get("role", "") if prof.data else ""
    is_coord = role in _ELEVATED or bool(
        db.table("coordinator").select("course_id")
        .eq("user_id", uid).eq("course_id", course_id).execute().data
    )
    if not is_coord:
        # only guide — restrict to their teams
        guide_check = db.table("project").select("project_id").eq("course_id", course_id).eq("guide_id", uid).execute()
        if not guide_check.data:
            raise HTTPException(403, "Access restricted to coordinators and guides.")

    query = (
        db.table("project")
        .select("project_id, title, team_number, students:student(student_id, usn, name)")
        .eq("course_id", course_id)
        .order("team_number", nullsfirst=False)
    )
    if not is_coord:
        query = query.eq("guide_id", uid)
    proj_rows = query.execute().data or []

    if not proj_rows:
        return []

    project_ids = [p["project_id"] for p in proj_rows]
    marks = (
        db.table("evaluation_mark")
        .select("project_id, student_id, scorer_id, scorer_type, c1, c2, c3, c4, c5")
        .eq("eval_review_id", eval_review_id)
        .in_("project_id", project_ids)
        .execute().data or []
    )

    scorer_ids = list({m["scorer_id"] for m in marks})
    scorer_map: dict = {}
    if scorer_ids:
        profs = db.table("profiles").select("id, name, email").in_("id", scorer_ids).execute().data or []
        scorer_map = {p["id"]: p for p in profs}

    meta  = REVIEW_META.get(review_number, {})
    num_c = len(meta.get("criteria", []))

    result = []
    for proj in proj_rows:
        pid = proj["project_id"]
        proj_marks = [m for m in marks if m["project_id"] == pid]
        students_out = []
        for s in (proj.get("students") or []):
            sid = s["student_id"]
            s_marks = [m for m in proj_marks if m["student_id"] == sid]
            marks_out = []
            for m in s_marks:
                sc    = scorer_map.get(m["scorer_id"], {})
                total = sum((m.get(f"c{i}") or 0) for i in range(1, num_c + 1))
                marks_out.append({
                    "scorer_name": sc.get("name") or sc.get("email", "Unknown"),
                    "scorer_type": m["scorer_type"],
                    **{f"c{i}": m.get(f"c{i}") for i in range(1, 6)},
                    "total": total,
                })
            students_out.append({**s, "marks": marks_out})
        result.append({
            "project_id":  pid,
            "title":       proj.get("title", ""),
            "team_number": proj.get("team_number"),
            "students":    students_out,
        })
    return result


@router.get("/courses/{course_id}/download-marks-excel")
def download_marks_excel(course_id: str, user=Depends(verify_token)):
    require_coordinator_for_course(course_id, user)

    # ── Course / semester / batch info ────────────────────────────────────────
    course_row = db.table("course").select("course_name, course_code, semester_id").eq("course_id", course_id).execute()
    if not course_row.data:
        raise HTTPException(404, "Course not found.")
    course      = course_row.data[0]
    course_name = course.get("course_name", "")
    course_code = course.get("course_code", "") or ""
    course_label = f"{course_code} / {course_name}" if course_code else course_name

    sem_row    = db.table("semester").select("sem_number, batch_id").eq("semester_id", course["semester_id"]).execute()
    sem        = sem_row.data[0] if sem_row.data else {}
    sem_number = sem.get("sem_number", "")

    batch_row  = db.table("batch").select("year").eq("batch_id", sem.get("batch_id", "")).execute()
    batch_year = batch_row.data[0].get("year") if batch_row.data else None
    acad_year  = f"{batch_year}-{str(batch_year + 1)[2:]}" if batch_year else ""

    # ── Projects ──────────────────────────────────────────────────────────────
    projects = (
        db.table("project")
        .select("project_id, title, guide_id, team_number, students:student(student_id, usn, name)")
        .eq("course_id", course_id)
        .order("team_number", nullsfirst=False)
        .execute().data or []
    )
    if not projects:
        raise HTTPException(400, "No projects in this course.")

    for p in projects:
        p["students"] = sorted(p.get("students") or [], key=lambda s: s.get("usn") or "")

    project_ids = [p["project_id"] for p in projects]

    # ── Examiners per project ─────────────────────────────────────────────────
    exam_rows = (
        db.table("project_examiner").select("project_id, user_id, created_at")
        .in_("project_id", project_ids).order("created_at").execute().data or []
    )
    exam_by_proj: dict = {}
    for e in exam_rows:
        exam_by_proj.setdefault(e["project_id"], []).append(e["user_id"])

    # ── Scorer name map ───────────────────────────────────────────────────────
    scorer_ids = list(
        {p.get("guide_id") for p in projects if p.get("guide_id")}
        | {uid for uids in exam_by_proj.values() for uid in uids}
    )
    scorer_name_map: dict = {}
    if scorer_ids:
        profs = db.table("profiles").select("id, name").in_("id", scorer_ids).execute().data or []
        scorer_name_map = {p["id"]: p.get("name", "") for p in profs}

    # ── Evaluation reviews & marks ────────────────────────────────────────────
    eval_reviews = (
        db.table("evaluation_review").select("id, review_number")
        .eq("course_id", course_id).order("review_number").execute().data or []
    )
    rev_id_by_num = {r["review_number"]: r["id"] for r in eval_reviews}

    all_rev_ids = list(rev_id_by_num.values())
    all_marks = (
        db.table("evaluation_mark")
        .select("eval_review_id, project_id, student_id, scorer_id, c1, c2, c3, c4, c5")
        .in_("eval_review_id", all_rev_ids)
        .execute().data or []
    ) if all_rev_ids else []

    marks_idx: dict = {}
    for m in all_marks:
        marks_idx[(m["eval_review_id"], m["project_id"], m["scorer_id"], m["student_id"])] = m

    # ── Styles ────────────────────────────────────────────────────────────────
    THIN_SIDE   = Side(style="thin")
    ALL_BORDER  = Border(left=THIN_SIDE, right=THIN_SIDE, top=THIN_SIDE, bottom=THIN_SIDE)
    title_font  = Font(name="Calibri", size=14, bold=True)
    hdr_font    = Font(name="Calibri", size=9,  bold=True)
    info_font   = Font(name="Calibri", size=9)
    center_wrap = Alignment(horizontal="center", vertical="center", wrap_text=True)
    center_mid  = Alignment(horizontal="center", vertical="center")
    right_mid   = Alignment(horizontal="right",  vertical="center")
    left_mid    = Alignment(horizontal="left",   vertical="center")

    def _col_letter(n: int) -> str:
        r = ""
        while n > 0:
            n, rem = divmod(n - 1, 26)
            r = chr(65 + rem) + r
        return r

    def _border_row(ws, row: int, start_col: int, end_col: int) -> None:
        for col in range(start_col, end_col + 1):
            left  = THIN_SIDE if col == start_col else Side(style=None)
            right = THIN_SIDE if col == end_col   else Side(style=None)
            ws.cell(row=row, column=col).border = Border(
                left=left, right=right, top=THIN_SIDE, bottom=THIN_SIDE
            )

    wb = Workbook()
    wb.remove(wb.active)

    def _make_sheet(rev_num: int, sheet_label: str, scorer_key):
        """
        scorer_key: 'guide'  → project.guide_id
                    int (0/1) → examiners_by_proj index
        """
        meta       = REVIEW_META[rev_num]
        criteria   = meta["criteria"]
        num_c      = len(criteria)
        max_each   = meta["max_each"]
        max_total  = meta["max_total"]
        rev_id     = rev_id_by_num.get(rev_num)
        total_cols = 3 + num_c + 1   # Sl.No + USN + Names + criteria + Total
        split_col  = total_cols - 2  # right part starts here (last 3 cols)

        ws = wb.create_sheet(title=f"R{rev_num} {sheet_label}"[:31])

        ws.column_dimensions["A"].width = 7
        ws.column_dimensions["B"].width = 14
        ws.column_dimensions["C"].width = 24
        for i in range(num_c):
            ws.column_dimensions[_col_letter(4 + i)].width = 14
        ws.column_dimensions[_col_letter(4 + num_c)].width = 10

        row = 1
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=total_cols)
        tc = ws.cell(row=row, column=1, value=f"Review {rev_num} : {meta['phase']}")
        tc.font = title_font
        tc.alignment = center_wrap
        ws.row_dimensions[row].height = 28
        row += 1

        for proj in projects:
            pid      = proj["project_id"]
            students = proj.get("students") or []

            if scorer_key == "guide":
                scorer_id = proj.get("guide_id")
            else:
                exams     = exam_by_proj.get(pid, [])
                scorer_id = exams[scorer_key] if len(exams) > scorer_key else None
            scorer_name = scorer_name_map.get(scorer_id, "") if scorer_id else ""

            if row > 2:
                row += 1  # blank separator between teams

            # Info row 1: Course Code/Title | Academic Year
            ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=split_col - 1)
            c = ws.cell(row=row, column=1, value=f"Course Code/Course Title:{course_label}")
            c.font = info_font; c.alignment = left_mid
            _border_row(ws, row, 1, split_col - 1)
            ws.merge_cells(start_row=row, start_column=split_col, end_row=row, end_column=total_cols)
            c = ws.cell(row=row, column=split_col, value=f"Academic Year:{acad_year}")
            c.font = info_font; c.alignment = right_mid
            _border_row(ws, row, split_col, total_cols)
            row += 1

            # Info row 2: Semester | Evaluator
            ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=split_col - 1)
            c = ws.cell(row=row, column=1, value=f"Semester:{sem_number}")
            c.font = info_font; c.alignment = left_mid
            _border_row(ws, row, 1, split_col - 1)
            ws.merge_cells(start_row=row, start_column=split_col, end_row=row, end_column=total_cols)
            c = ws.cell(row=row, column=split_col, value=f"Evaluator:{scorer_name}")
            c.font = info_font; c.alignment = right_mid
            _border_row(ws, row, split_col, total_cols)
            row += 1

            # Info row 3: Project Title | Date
            ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=split_col - 1)
            c = ws.cell(row=row, column=1, value=f"Project Title:{proj.get('title', '')}")
            c.font = info_font; c.alignment = left_mid
            _border_row(ws, row, 1, split_col - 1)
            ws.merge_cells(start_row=row, start_column=split_col, end_row=row, end_column=total_cols)
            c = ws.cell(row=row, column=split_col, value="Date:")
            c.font = info_font; c.alignment = right_mid
            _border_row(ws, row, split_col, total_cols)
            row += 1

            # Column header row
            for col_idx, val in enumerate(["Sl. No", "USN", "Names"], 1):
                c = ws.cell(row=row, column=col_idx, value=val)
                c.font = hdr_font; c.border = ALL_BORDER; c.alignment = center_wrap
            for i, crit in enumerate(criteria):
                c = ws.cell(row=row, column=4 + i, value=f"{crit}\n({max_each} Marks)")
                c.font = hdr_font; c.border = ALL_BORDER; c.alignment = center_wrap
            c = ws.cell(row=row, column=4 + num_c, value=f"Total\n({max_total} Marks)")
            c.font = hdr_font; c.border = ALL_BORDER; c.alignment = center_wrap
            ws.row_dimensions[row].height = 44
            row += 1

            # Student rows
            for sl, stu in enumerate(students, 1):
                stu_id   = stu["student_id"]
                mark_row = marks_idx.get((rev_id, pid, scorer_id, stu_id)) if (rev_id and scorer_id) else None

                ws.cell(row=row, column=1, value=sl).border        = ALL_BORDER
                ws.cell(row=row, column=1).alignment               = center_mid
                ws.cell(row=row, column=2, value=stu.get("usn", "")).border = ALL_BORDER
                ws.cell(row=row, column=2).alignment               = center_mid
                ws.cell(row=row, column=3, value=stu.get("name", "")).border = ALL_BORDER
                ws.cell(row=row, column=3).alignment               = left_mid

                total     = 0
                has_marks = False
                for i in range(num_c):
                    val = mark_row.get(f"c{i + 1}") if mark_row else None
                    c   = ws.cell(row=row, column=4 + i, value=val)
                    c.border = ALL_BORDER; c.alignment = center_mid
                    if val is not None:
                        total += val; has_marks = True

                c = ws.cell(row=row, column=4 + num_c, value=total if has_marks else None)
                c.border = ALL_BORDER; c.alignment = center_mid
                row += 1

    # ── Build sheets: guide + up to 2 evaluators, for each review ─────────────
    for rev_num in (1, 2, 3):
        _make_sheet(rev_num, "Guide", "guide")
        for eval_idx in (0, 1):
            if any(len(exam_by_proj.get(p["project_id"], [])) > eval_idx for p in projects):
                _make_sheet(rev_num, f"Eval {eval_idx + 1}", eval_idx)

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    safe_name = (course_code or course_name).replace(" ", "_")
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="evaluation_{safe_name}.xlsx"'},
    )


# ─────────────────────────────────────────────────────────────────────────────
# 6a — Consolidated marks sheet (one row per student, Final CE auto-calculated)
# Formula: R1_avg + R2_avg → /100; R3_avg → /100; CE = round((R1R2 + R3) / 2)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/courses/{course_id}/download-ce-sheet")
def download_ce_sheet(course_id: str, user=Depends(verify_token)):
    require_coordinator_for_course(course_id, user)

    # ── Course / semester / batch info ────────────────────────────────────────
    course_row = db.table("course").select("course_name, course_code, semester_id").eq("course_id", course_id).execute()
    if not course_row.data:
        raise HTTPException(404, "Course not found.")
    course      = course_row.data[0]
    course_name = course.get("course_name", "")
    course_code = course.get("course_code", "") or ""
    course_label = f"{course_code} / {course_name}" if course_code else course_name

    sem_row    = db.table("semester").select("sem_number, batch_id").eq("semester_id", course["semester_id"]).execute()
    sem        = sem_row.data[0] if sem_row.data else {}
    sem_number = sem.get("sem_number", "")

    batch_row  = db.table("batch").select("year").eq("batch_id", sem.get("batch_id", "")).execute()
    batch_year = batch_row.data[0].get("year") if batch_row.data else None
    acad_year  = f"{batch_year}-{str(batch_year + 1)[2:]}" if batch_year else ""

    # ── All projects + students in this course ────────────────────────────────
    projects = (
        db.table("project")
        .select("project_id, guide_id, students:student(student_id, usn, name)")
        .eq("course_id", course_id)
        .order("team_number", nullsfirst=False)
        .execute().data or []
    )

    # Flatten to per-student list, sorted by USN
    all_students: list[dict] = []
    for proj in projects:
        pid     = proj["project_id"]
        guide_id = proj.get("guide_id")
        for s in sorted(proj.get("students") or [], key=lambda x: x.get("usn") or ""):
            all_students.append({
                "student_id": s["student_id"],
                "usn":        s.get("usn", ""),
                "name":       s.get("name", ""),
                "project_id": pid,
                "guide_id":   guide_id,
            })

    if not all_students:
        raise HTTPException(400, "No students found in this course.")

    project_ids = list({s["project_id"] for s in all_students})

    # ── Examiners per project ─────────────────────────────────────────────────
    exam_rows = (
        db.table("project_examiner").select("project_id, user_id")
        .in_("project_id", project_ids).execute().data or []
    )
    examiners_by_proj: dict = {}
    for e in exam_rows:
        examiners_by_proj.setdefault(e["project_id"], []).append(e["user_id"])

    # ── Evaluation reviews for this course ────────────────────────────────────
    eval_reviews = (
        db.table("evaluation_review").select("id, review_number")
        .eq("course_id", course_id).order("review_number").execute().data or []
    )
    rev_id_by_num = {r["review_number"]: r["id"] for r in eval_reviews}

    # ── All marks ─────────────────────────────────────────────────────────────
    all_rev_ids = list(rev_id_by_num.values())
    raw_marks = (
        db.table("evaluation_mark")
        .select("eval_review_id, project_id, student_id, scorer_id, scorer_type, c1, c2, c3, c4, c5")
        .in_("eval_review_id", all_rev_ids)
        .execute().data or []
    ) if all_rev_ids else []

    # Index: (eval_review_id, student_id, scorer_id) → mark row
    marks_idx: dict = {}
    for m in raw_marks:
        marks_idx[(m["eval_review_id"], m["student_id"], m["scorer_id"])] = m

    def _total(mark_row: dict | None, num_criteria: int) -> float | None:
        if not mark_row:
            return None
        vals = [mark_row.get(f"c{i}") for i in range(1, num_criteria + 1)]
        if all(v is None for v in vals):
            return None
        return sum(v or 0 for v in vals)

    def _student_review_avg(student_id: str, project_id: str, rev_num: int) -> float | None:
        """Average total across guide + all evaluators for one student+review."""
        rev_id   = rev_id_by_num.get(rev_num)
        if not rev_id:
            return None
        meta     = REVIEW_META.get(rev_num, {})
        num_c    = len(meta.get("criteria", []))

        # Collect all scorer_ids for this project (guide + examiners)
        pid      = project_id
        scorer_ids_for_proj: list[str] = []
        for s in all_students:
            if s["project_id"] == pid and s.get("guide_id"):
                gid = s["guide_id"]
                if gid not in scorer_ids_for_proj:
                    scorer_ids_for_proj.append(gid)
                break
        scorer_ids_for_proj += [uid for uid in examiners_by_proj.get(pid, [])
                                 if uid not in scorer_ids_for_proj]

        totals = []
        for sid in scorer_ids_for_proj:
            row = marks_idx.get((rev_id, student_id, sid))
            t   = _total(row, num_c)
            if t is not None:
                totals.append(t)

        return sum(totals) / len(totals) if totals else None

    def _typed_avg(student_id: str, project_id: str, rev_num: int, stype: str) -> float | None:
        rev_id = rev_id_by_num.get(rev_num)
        if not rev_id:
            return None
        num_c = len(REVIEW_META.get(rev_num, {}).get("criteria", []))
        if stype == "guide":
            gid = next((s["guide_id"] for s in all_students
                        if s["project_id"] == project_id and s.get("guide_id")), None)
            if not gid:
                return None
            return _total(marks_idx.get((rev_id, student_id, gid)), num_c)
        else:
            totals = [t for eid in examiners_by_proj.get(project_id, [])
                      if (t := _total(marks_idx.get((rev_id, student_id, eid)), num_c)) is not None]
            return sum(totals) / len(totals) if totals else None

    def _avg2(a: float | None, b: float | None) -> float | None:
        vals = [x for x in [a, b] if x is not None]
        return sum(vals) / len(vals) if vals else None

    # ── Build Excel ───────────────────────────────────────────────────────────
    THIN     = Side(style="thin")
    ALL_BDR  = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
    title_f  = Font(name="Calibri", size=13, bold=True)
    hdr_f    = Font(name="Calibri", size=9,  bold=True)
    body_f   = Font(name="Calibri", size=9)
    c_align  = Alignment(horizontal="center", vertical="center", wrap_text=True)
    l_align  = Alignment(horizontal="left",   vertical="center")

    wb  = Workbook()
    ws  = wb.active
    ws.title = "CE Marks"

    # Column widths (matching 6a template: D=USN, E=Name, F-K=reviews, L=CE)
    # We use cols 1-9: Sl.No, USN, Name, R1G, R1E, R2G, R2E, R3G, R3E, CE
    col_widths = [5, 14, 26, 14, 14, 14, 14, 14, 14, 11]
    for i, w in enumerate(col_widths, 1):
        ws.column_dimensions[ws.cell(1, i).column_letter].width = w

    # ── Title block (rows 1-4) ────────────────────────────────────────────────
    ws.merge_cells("A1:J1")
    ws.merge_cells("A2:J2")
    t = ws.cell(2, 1, "Mini Project Evaluation marks")
    t.font = title_f; t.alignment = c_align
    ws.row_dimensions[2].height = 20

    ws.merge_cells("A3:J3")
    c = ws.cell(3, 1, f"Course Code/Course Title: {course_label}")
    c.font = body_f; c.alignment = l_align

    ws.merge_cells("A4:J4")
    c = ws.cell(4, 1, f"Semester: {sem_number}    Academic Year: {acad_year}")
    c.font = body_f; c.alignment = l_align

    # ── Column header rows (5-6) ──────────────────────────────────────────────
    headers_row5 = [
        "Sl. No", "USN", "Student Name",
        "Review 1-Guide\n(Problem & Design Phase)",
        "Review 1-Evaluator\n(Problem & Design Phase)",
        "Review 2-Guide\n(Implementation Phase)",
        "Review 2-Evaluator\n(Implementation Phase)",
        "Review 3-Guide\n(Demonstration Phase)",
        "Review 3-Evaluator\n(Demonstration Phase)",
        "Final CE",
    ]
    max_row5 = [
        "", "", "",
        "Max Marks-50", "Max Marks-50",
        "Max Marks-50", "Max Marks-50",
        "Max Marks-100", "Max Marks-100",
        "Max Marks-100",
    ]
    hdr_fill = PatternFill(start_color="0D1B2A", end_color="0D1B2A", fill_type="solid")
    sub_fill = PatternFill(start_color="1C2E40", end_color="1C2E40", fill_type="solid")
    hdr_font_color = Font(name="Calibri", size=9, bold=True, color="F5A623")
    sub_font_color = Font(name="Calibri", size=8, bold=False, color="AAAAAA")

    for col, (h, s) in enumerate(zip(headers_row5, max_row5), 1):
        c1 = ws.cell(5, col, h)
        c1.font  = hdr_font_color; c1.fill = hdr_fill
        c1.border = ALL_BDR; c1.alignment = c_align
        c2 = ws.cell(6, col, s)
        c2.font  = sub_font_color; c2.fill = sub_fill
        c2.border = ALL_BDR; c2.alignment = c_align

    ws.row_dimensions[5].height = 42
    ws.row_dimensions[6].height = 16

    # ── Student rows ──────────────────────────────────────────────────────────
    ce_col = 10
    for sl, stu in enumerate(all_students, 1):
        row = 6 + sl
        sid  = stu["student_id"]
        pid  = stu["project_id"]

        r1_g = _typed_avg(sid, pid, 1, "guide")
        r1_e = _typed_avg(sid, pid, 1, "evaluator")
        r2_g = _typed_avg(sid, pid, 2, "guide")
        r2_e = _typed_avg(sid, pid, 2, "evaluator")
        r3_g = _typed_avg(sid, pid, 3, "guide")
        r3_e = _typed_avg(sid, pid, 3, "evaluator")

        r1_avg = _avg2(r1_g, r1_e)  # /50
        r2_avg = _avg2(r2_g, r2_e)  # /50
        r3_avg = _avg2(r3_g, r3_e)  # /100

        # Final CE = round((R1_avg + R2_avg + R3_avg) / 2)
        # R1+R2 both /50 so combined /100, then avg with R3 /100
        if r1_avg is not None or r2_avg is not None or r3_avg is not None:
            r1r2 = (r1_avg or 0) + (r2_avg or 0)   # /100
            r3   = r3_avg or 0                       # /100
            ce   = round((r1r2 + r3) / 2)
        else:
            ce = None

        values = [sl, stu["usn"], stu["name"],
                  r1_g, r1_e, r2_g, r2_e, r3_g, r3_e, ce]

        alt_fill = PatternFill(start_color="F7F9FC", end_color="F7F9FC", fill_type="solid") if sl % 2 == 0 else None

        for col, val in enumerate(values, 1):
            cell = ws.cell(row, col)
            if val is not None:
                cell.value = round(val) if isinstance(val, float) else val
            cell.font   = body_f
            cell.border = ALL_BDR
            cell.alignment = c_align if col != 3 else l_align
            if alt_fill:
                cell.fill = alt_fill

        # Bold + highlight Final CE
        ce_cell = ws.cell(row, ce_col)
        ce_cell.font = Font(name="Calibri", size=9, bold=True)
        if ce is not None:
            ce_cell.fill = PatternFill(start_color="E8F5E9", end_color="E8F5E9", fill_type="solid")

    # ── Footer row ────────────────────────────────────────────────────────────
    footer_row = 6 + len(all_students) + 1
    ws.merge_cells(f"A{footer_row}:C{footer_row}")
    ws.cell(footer_row, 1, "Formula: CE = round((R1_avg + R2_avg + R3_avg) / 2)").font = Font(size=7, italic=True, color="888888")

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    safe_name = (course_code or course_name).replace(" ", "_")
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="CE_marks_{safe_name}.xlsx"'},
    )


# ─────────────────────────────────────────────────────────────────────────────
# Course documents (Supabase Storage)
# ─────────────────────────────────────────────────────────────────────────────

_DOC_BUCKET = "course-docs"
_bucket_ready = False


def _ensure_doc_bucket() -> None:
    global _bucket_ready
    if _bucket_ready:
        return
    try:
        db.storage.create_bucket(_DOC_BUCKET, options={"public": True})
    except Exception:
        pass  # already exists
    _bucket_ready = True


@router.get("/courses/{course_id}/docs")
def list_docs(course_id: str, _user=Depends(verify_token)):
    rows = (
        db.table("course_document")
        .select("id, name, file_url, file_type, file_size, created_at, uploaded_by")
        .eq("course_id", course_id)
        .order("created_at", desc=True)
        .execute().data or []
    )
    uploader_ids = list({r["uploaded_by"] for r in rows if r.get("uploaded_by")})
    name_map: dict = {}
    if uploader_ids:
        profs = db.table("profiles").select("id, name, email").in_("id", uploader_ids).execute().data or []
        name_map = {p["id"]: p.get("name") or p.get("email", "") for p in profs}
    for r in rows:
        r["uploaded_by_name"] = name_map.get(r.get("uploaded_by", ""), "")
    return rows


@router.post("/courses/{course_id}/docs")
async def upload_doc(
    course_id: str,
    file: UploadFile = File(...),
    user=Depends(verify_token),
):
    require_coordinator_for_course(course_id, user)
    _ensure_doc_bucket()

    contents = await file.read()
    if len(contents) > 20 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 20 MB).")

    safe_filename = re.sub(r"[^\w.\-]", "_", file.filename or "file")
    storage_path = f"{course_id}/{uuid.uuid4()}_{safe_filename}"
    content_type = file.content_type or "application/octet-stream"

    try:
        db.storage.from_(_DOC_BUCKET).upload(
            storage_path, contents, {"content-type": content_type}
        )
    except Exception as exc:
        raise HTTPException(500, f"Storage upload failed: {exc}")

    file_url = db.storage.from_(_DOC_BUCKET).get_public_url(storage_path)

    doc = db.table("course_document").insert({
        "course_id":   course_id,
        "name":        file.filename or safe_filename,
        "file_url":    file_url,
        "file_type":   content_type,
        "file_size":   len(contents),
        "uploaded_by": user.get("sub"),
    }).execute().data[0]
    return doc


@router.delete("/docs/{doc_id}")
def delete_doc(doc_id: str, user=Depends(verify_token)):
    row = db.table("course_document").select("course_id, file_url").eq("id", doc_id).execute()
    if not row.data:
        raise HTTPException(404, "Document not found.")
    require_coordinator_for_course(row.data[0]["course_id"], user)

    # Extract storage path from URL and delete from bucket
    file_url: str = row.data[0].get("file_url", "")
    marker = f"/object/public/{_DOC_BUCKET}/"
    if marker in file_url:
        storage_path = file_url.split(marker, 1)[1]
        try:
            db.storage.from_(_DOC_BUCKET).remove([storage_path])
        except Exception:
            pass  # best-effort; still delete the DB row

    db.table("course_document").delete().eq("id", doc_id).execute()
    return {"message": "Document deleted."}
