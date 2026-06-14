"""
Chatbot module — Groq-powered capabilities over the project DB and GitHub.

Endpoints:
  POST /chatbot/filter               — NL query → structured filter → projects
  POST /chatbot/explain/{project_id} — README summary (3-4 sentences)
  POST /chatbot/suggest/{project_id} — improvement ideas grounded in similar repos
  GET  /chatbot/health               — reports whether Groq is configured
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from jwt_auth import verify_token
from github_utils import (
    parse_repo_url,
    fetch_readme,
    search_repos,
    truncate_tokens,
)

router = APIRouter(prefix="/chatbot", tags=["chatbot"])

_GROQ_KEY = os.getenv("GROQ_API_KEY")
_MODEL    = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")

_README_CAP  = 3000
_RELATED_CAP = 1500
_TOTAL_CAP   = 4000

# Honorifics common in Indian-English that users append to names ("vindhya mam",
# "sharma sir") but are never part of the stored guide/student name.
_HONORIFICS = frozenset({
    "mam", "ma'am", "madam", "sir",
    "dr", "prof", "mr", "mrs", "ms", "miss",
})


def _strip_honorifics(name: str) -> str:
    return " ".join(
        t for t in name.split()
        if t.lower().rstrip(".") not in _HONORIFICS
    )


# ── Groq helpers ──────────────────────────────────────────────────────────────

def _groq_client():
    if not _GROQ_KEY:
        raise HTTPException(503, "GROQ_API_KEY not configured on the server.")
    try:
        from groq import Groq
    except ImportError:
        raise HTTPException(503, "groq package not installed on the server.")
    return Groq(api_key=_GROQ_KEY)


def _groq_chat(messages: list[dict], json_mode: bool = False, max_tokens: int = 800) -> str:
    client = _groq_client()
    kwargs = {
        "model": _MODEL,
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": max_tokens,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    try:
        resp = client.chat.completions.create(**kwargs)
        return resp.choices[0].message.content or ""
    except Exception as exc:
        raise HTTPException(502, f"LLM service error: {exc}")


# ── NL filter ─────────────────────────────────────────────────────────────────

class FilterRequest(BaseModel):
    query: str
    previous_filter: Optional[dict] = None


_FILTER_SYSTEM = """You extract a structured search filter from a natural-language query about student projects.
First correct obvious spelling mistakes in the query.

Decide the intent:
- "filter"    — user wants a list of projects matching criteria (most queries)
- "aggregate" — user wants counts, rankings, or analytical answers
  (e.g. "how many projects use React", "which guide has the most projects")

Output ONLY a JSON object — no explanation text.

For "filter" intent:
{
  "intent": "filter",
  "batch_name":   string  — e.g. "2024-2028" (only if a specific batch is mentioned),
  "sem_number":   integer — 1-8, MUST be a bare integer not a string (e.g. 5, not "5"),
  "course_name":  string  — substring of the course name,
  "title":        string  — substring of the project title,
  "guide_name":   string  — the teacher's actual name ONLY; strip every honorific/title
                            (mam, ma'am, sir, dr, prof, mr, mrs, ms, miss) before returning,
  "student_name": string  — the student's actual name ONLY; strip honorifics the same way,
  "keyword":      string  — a technology or domain word that should appear in the project title
                            or GitHub URL (e.g. "Python", "React", "machine learning")
}
Include only the keys that are clearly implied by the query.
If a previous filter is given, merge it with the new query — keep prior keys unless the
user is explicitly removing or changing them.
If the user wants everything with no specific criteria, return {"intent": "filter"} with no other keys.
NEVER invent values. Words like "all", "every", "any", "show", "list", "me" are not field values.

For "aggregate" intent:
{
  "intent": "aggregate",
  "aggregate_question": string — the normalised analytical question
}"""


def _normalise_spec(spec: dict) -> dict:
    """Coerce and sanitise the LLM-extracted spec before querying.

    Mutates spec in-place and returns it. Done here (not in the prompt alone)
    because LLMs are unreliable about types and honorific stripping.
    """
    # 1. sem_number must be an int — LLM sometimes returns "5", 5.0, or "fifth"
    if "sem_number" in spec:
        try:
            spec["sem_number"] = int(spec["sem_number"])
        except (ValueError, TypeError):
            del spec["sem_number"]

    # 2. Strip honorifics from name fields and write the clean value back into
    #    spec so the frontend's lastFilterRef gets the clean version too
    #    (prevents dirty values from cascading into follow-up queries).
    for key in ("guide_name", "student_name"):
        val = spec.get(key)
        if not isinstance(val, str) or not val.strip():
            spec.pop(key, None)
            continue
        cleaned = _strip_honorifics(val.strip())
        if cleaned:
            spec[key] = cleaned
        else:
            del spec[key]  # was all-honorific, e.g. just "mam"

    # 3. Drop any remaining string fields that are empty, None, or wrong type
    for key in ("batch_name", "course_name", "title", "keyword"):
        val = spec.get(key)
        if val is None or not isinstance(val, str) or not val.strip():
            spec.pop(key, None)

    return spec


def _build_summary(count: int, spec: dict) -> str:
    parts = []
    if spec.get("batch_name"):
        parts.append(f"Batch {spec['batch_name']}")
    if spec.get("sem_number"):
        parts.append(f"Semester {spec['sem_number']}")
    if spec.get("course_name"):
        parts.append(spec["course_name"])
    if spec.get("guide_name"):
        parts.append(f"guided by {spec['guide_name']}")
    if spec.get("student_name"):
        parts.append(f"student \"{spec['student_name']}\"")
    if spec.get("title"):
        parts.append(f'title containing "{spec["title"]}"')
    if spec.get("keyword"):
        parts.append(f'keyword "{spec["keyword"]}"')
    noun = "project" if count == 1 else "projects"
    base = f"{count} {noun} found"
    return f"{base} for {', '.join(parts)}." if parts else f"{base}."


def _handle_aggregate(question: str) -> dict:
    from project_tracker import db
    # Fetch up to 1000 so aggregate answers cover the full DB at department scale
    rows = db.table("project").select(
        "title,guide,course(course_name,semester(sem_number,batch(batch_name)))"
    ).limit(1000).execute().data or []

    lines = []
    for p in rows:
        course = p.get("course") or {}
        sem    = course.get("semester") or {}
        batch  = sem.get("batch") or {}
        lines.append(
            f"- {p.get('title') or '?'} | Guide: {p.get('guide') or '?'} | "
            f"Course: {course.get('course_name') or '?'} | "
            f"Sem: {sem.get('sem_number') or '?'} | Batch: {batch.get('batch_name') or '?'}"
        )

    answer = _groq_chat(
        [
            {"role": "system", "content":
             "You answer analytical questions about a list of student projects. "
             "Be concise and direct. Use numbers when relevant. No markdown headers."},
            {"role": "user", "content":
             f"QUESTION: {question}\n\nPROJECTS ({len(rows)} total):\n" + "\n".join(lines)},
        ],
        max_tokens=400,
    )
    return {"type": "aggregate", "answer": answer.strip(), "total_projects": len(rows)}


def _suggest_rephrasing(original_query: str, applied_filter: dict) -> str:
    raw = _groq_chat(
        [
            {"role": "system", "content":
             "A user searched for student projects but got zero results. "
             "Suggest one simpler or broader rephrasing in a single short sentence. "
             "Be specific — mention what to try removing or relaxing. No preamble."},
            {"role": "user", "content":
             f"Original query: {original_query}\nApplied filter: {json.dumps(applied_filter)}"},
        ],
        max_tokens=100,
    )
    return raw.strip()


@router.post("/filter")
def chatbot_filter(req: FilterRequest, user: dict = Depends(verify_token)):
    user_msg = req.query.strip()
    if req.previous_filter:
        user_msg = (
            f"Previous filter applied: {json.dumps(req.previous_filter)}\n"
            f"New query (refine or modify the previous filter): {req.query.strip()}"
        )

    raw = _groq_chat(
        [
            {"role": "system", "content": _FILTER_SYSTEM},
            {"role": "user",   "content": user_msg},
        ],
        json_mode=True,
        max_tokens=300,
    )
    try:
        spec = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(502, "Model returned non-JSON filter spec.")

    intent             = spec.pop("intent", "filter")
    aggregate_question = spec.pop("aggregate_question", None)

    if intent == "aggregate":
        return _handle_aggregate(aggregate_question or req.query)

    # Normalise types, strip honorifics, drop empty fields — must happen before
    # any querying so all downstream logic sees clean, predictable values.
    _normalise_spec(spec)

    from project_tracker import db

    q = db.table("project").select(
        "project_id,title,github,guide,readme_cache,"
        "student(name,usn),"
        "course(course_name,semester(sem_number,batch(batch_name)))"
    )

    # ── SQL-level filters (fields that live directly on the project row) ───────

    # Title: single ilike is safe — user-facing title substring
    if spec.get("title"):
        q = q.ilike("title", f"%{spec['title']}%")

    # Guide: tokenise the cleaned name and OR across tokens so partial names
    # and multi-part names both resolve correctly.
    # e.g. "vindhya" → guide ILIKE '%vindhya%'
    # e.g. "vindhya malagi" → guide ILIKE '%vindhya%' OR guide ILIKE '%malagi%'
    # Single-char tokens (initials) are skipped to avoid broad false matches.
    if spec.get("guide_name"):
        tokens = [t for t in spec["guide_name"].split() if len(t) > 1]
        if tokens:
            q = q.or_(",".join(f"guide.ilike.%{t}%" for t in tokens))

    # Keyword, batch_name, course_name, sem_number, and student_name are all
    # handled in the Python post-filter below.  Keyword in particular MUST NOT
    # be put into a SQL OR string because:
    #   a) user input with commas would break the OR syntax (injection)
    #   b) the readme_cache column may not exist in the DB, crashing the query
    #   c) a second .or_() call alongside guide_name has undefined AND/OR
    #      semantics across PostgREST versions

    # Fetch enough rows that the Python post-filter sees the full relevant set.
    # 1000 is safe for department scale and avoids the silent truncation bug
    # where limit(50) cuts results before batch/semester post-filtering.
    rows = q.limit(1000).execute().data or []

    # ── Python post-filter (nested fields + keyword) ──────────────────────────

    def _tokens(s: str) -> list[str]:
        return [t.lower() for t in s.split() if len(t) > 1]

    def keep(p: dict) -> bool:
        course = p.get("course") or {}
        sem    = course.get("semester") or {}
        batch  = sem.get("batch") or {}

        if spec.get("course_name"):
            if spec["course_name"].lower() not in (course.get("course_name") or "").lower():
                return False

        if spec.get("batch_name"):
            if spec["batch_name"].lower() not in (batch.get("batch_name") or "").lower():
                return False

        if isinstance(spec.get("sem_number"), int):
            if sem.get("sem_number") != spec["sem_number"]:
                return False

        if spec.get("student_name"):
            toks     = _tokens(spec["student_name"])
            students = p.get("student") or []
            # A project matches if at least one of its students has a name
            # containing at least one name token (handles partial names).
            if toks and not any(
                any(tok in (s.get("name") or "").lower() for tok in toks)
                for s in students
            ):
                return False

        if spec.get("keyword"):
            toks         = _tokens(spec["keyword"])
            title_lower  = (p.get("title") or "").lower()
            github_lower = (p.get("github") or "").lower()
            readme_lower = (p.get("readme_cache") or "").lower()
            # Every keyword token must appear in title, github URL, or cached README.
            if toks and not all(
                tok in title_lower or tok in github_lower or tok in readme_lower
                for tok in toks
            ):
                return False

        return True

    filtered = [p for p in rows if keep(p)]
    summary   = _build_summary(len(filtered), spec)
    rephrasing = _suggest_rephrasing(req.query, spec) if not filtered else None

    return {
        "type":       "filter",
        "filter":     spec,
        "count":      len(filtered),
        "projects":   filtered,
        "summary":    summary,
        "rephrasing": rephrasing,
    }


# ── Explain README ────────────────────────────────────────────────────────────

_CACHE_TTL = timedelta(days=7)


def _load_project_with_readme(project_id: str) -> tuple[dict, Optional[str], Optional[str]]:
    from project_tracker import db
    proj = db.table("project").select("*").eq("project_id", project_id).execute()
    if not proj.data:
        raise HTTPException(404, "Project not found.")
    p = proj.data[0]

    cached_at_raw = p.get("readme_cached_at")
    if p.get("readme_cache") and cached_at_raw:
        try:
            cached_at = datetime.fromisoformat(cached_at_raw.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) - cached_at < _CACHE_TTL:
                return p, p["readme_cache"], None
        except ValueError:
            pass

    parsed = parse_repo_url(p.get("github"))
    if not parsed:
        return p, None, "no_github_url"
    readme = fetch_readme(*parsed)
    if not readme:
        return p, None, "readme_unreachable"

    db.table("project").update({
        "readme_cache":     readme,
        "readme_cached_at": datetime.now(timezone.utc).isoformat(),
    }).eq("project_id", project_id).execute()

    return p, readme, None


@router.post("/explain/{project_id}")
def chatbot_explain(project_id: str, user: dict = Depends(verify_token)):
    p, readme, reason = _load_project_with_readme(project_id)
    if not readme:
        return {
            "project_id": project_id,
            "summary":    None,
            "reason":     reason,
            "title":      p.get("title"),
        }

    snippet = truncate_tokens(readme, _README_CAP)
    summary = _groq_chat(
        [
            {"role": "system", "content":
             "You explain a student project's README in 3-4 plain sentences. "
             "Cover: what it does, the tech stack, and the most interesting feature. "
             "No bullet points, no markdown, no preamble."},
            {"role": "user", "content":
             f"Project title: {p.get('title') or 'untitled'}\n\nREADME:\n{snippet}"},
        ],
        max_tokens=400,
    )
    return {
        "project_id": project_id,
        "title":      p.get("title"),
        "summary":    summary.strip(),
        "reason":     None,
    }


# ── Suggest improvements ──────────────────────────────────────────────────────

_KEYWORD_SYSTEM = """Extract 3-5 short search keywords (1-3 words each) describing the
project's domain and core tech, suitable for GitHub repository search.
Output ONLY JSON: {"keywords": ["...", "..."]}. No prose."""


def _extract_keywords(title: str, readme: Optional[str]) -> list[str]:
    body = title or ""
    if readme:
        body += "\n\n" + truncate_tokens(readme, 1200)
    raw = _groq_chat(
        [
            {"role": "system", "content": _KEYWORD_SYSTEM},
            {"role": "user",   "content": body or "an unspecified student project"},
        ],
        json_mode=True,
        max_tokens=200,
    )
    try:
        data = json.loads(raw)
        kws  = data.get("keywords") or []
        return [str(k).strip() for k in kws if str(k).strip()][:5]
    except json.JSONDecodeError:
        return re.findall(r"[A-Za-z][A-Za-z0-9+.-]{2,}", title or "")[:5]


@router.post("/suggest/{project_id}")
def chatbot_suggest(project_id: str, user: dict = Depends(verify_token)):
    p, readme, _reason = _load_project_with_readme(project_id)

    keywords = _extract_keywords(p.get("title") or "", readme)
    if not keywords:
        raise HTTPException(422, "Could not derive keywords for this project.")

    related        = search_repos(" ".join(keywords), limit=3)
    context_parts: list[str] = []
    related_cards:  list[dict] = []
    used = 0

    for r in related:
        full = r.get("full_name") or ""
        if "/" not in full:
            continue
        owner, repo = full.split("/", 1)
        rd       = fetch_readme(owner, repo) or ""
        rd_short = truncate_tokens(rd, _RELATED_CAP)
        if used + len(rd_short) > _TOTAL_CAP * 4:
            rd_short = rd_short[: max(0, _TOTAL_CAP * 4 - used)]
        used += len(rd_short)
        related_cards.append({
            "name":        full,
            "stars":       r.get("stargazers_count"),
            "url":         r.get("html_url"),
            "description": r.get("description"),
        })
        if rd_short:
            context_parts.append(f"### {full}\n{rd_short}")

    own_snippet = truncate_tokens(readme or "", _README_CAP)
    prompt = (
        f"PROJECT TITLE: {p.get('title') or 'untitled'}\n\n"
        f"PROJECT README:\n{own_snippet or '(no README available)'}\n\n"
        f"RELATED REPOS (top by stars for keywords: {', '.join(keywords)}):\n"
        + ("\n\n".join(context_parts) or "(none reachable)")
    )

    suggestions_raw = _groq_chat(
        [
            {"role": "system", "content":
             "You are reviewing a student project. Output 4-6 concrete improvement "
             "suggestions inspired by patterns from the related popular repositories. "
             "Each suggestion: one short sentence, action-oriented, technology-specific. "
             "Output ONLY JSON: {\"suggestions\": [\"...\", \"...\"]}. No prose."},
            {"role": "user", "content": prompt},
        ],
        json_mode=True,
        max_tokens=600,
    )
    try:
        data        = json.loads(suggestions_raw)
        suggestions = [str(s).strip() for s in (data.get("suggestions") or []) if str(s).strip()]
    except json.JSONDecodeError:
        suggestions = []

    return {
        "project_id":  project_id,
        "title":       p.get("title"),
        "keywords":    keywords,
        "related":     related_cards,
        "suggestions": suggestions[:6],
    }


@router.get("/health")
def chatbot_health():
    return {"groq_configured": bool(_GROQ_KEY), "model": _MODEL}
