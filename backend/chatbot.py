"""
Chatbot module — five Groq-powered capabilities over the project DB and GitHub.

Endpoints:
  POST /chatbot/filter                    — NL query → structured filter → projects
  POST /chatbot/explain/{project_id}      — README summary (3-4 sentences)
  POST /chatbot/suggest/{project_id}      — improvement ideas grounded in similar repos
  GET  /chatbot/health                    — reports whether Groq is configured

The /project/{id}/readme passthrough lives in project_tracker.py (frontend renders it).
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
_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")

# Token caps (coarse char-based — see github_utils.truncate_tokens)
_README_CAP = 3000          # per-README cap before sending to LLM
_RELATED_CAP = 1500         # per-related-repo README cap
_TOTAL_CAP = 4000           # total context cap for suggest


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


# ───────────────────────── Capability 1: NL filter ─────────────────────────

class FilterRequest(BaseModel):
    query: str
    previous_filter: Optional[dict] = None


_FILTER_SYSTEM = """Process a natural-language query about student projects. First correct obvious spelling mistakes.

Decide the intent:
- "filter": user wants a list of projects matching criteria (most queries)
- "aggregate": user wants counts, rankings, or analytical answers
  (e.g. "how many projects use React", "which guide has the most projects", "most popular tech in sem 3")

Output ONLY a JSON object.

For "filter" intent:
{
  "intent": "filter",
  "batch_name": string e.g. "2024-2028",
  "sem_number": integer 1-8,
  "course_name": string substring,
  "title": string substring,
  "guide_name": string substring,
  "student_name": string (student first or last name),
  "keyword": string (searches title and github url)
}
Include only keys implied by the query. If a previous filter is provided in the user message, merge or refine it with the new query.

For "aggregate" intent:
{
  "intent": "aggregate",
  "aggregate_question": string (the normalized question to answer)
}

Never invent field values. Never include explanation text."""


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
    rows = db.table("project").select(
        "title,guide,course(course_name,semester(sem_number,batch(batch_name)))"
    ).limit(200).execute().data or []

    lines = []
    for p in rows:
        course = p.get("course") or {}
        sem = course.get("semester") or {}
        batch = sem.get("batch") or {}
        lines.append(
            f"- {p.get('title') or '?'} | Guide: {p.get('guide') or '?'} | "
            f"Course: {course.get('course_name') or '?'} | "
            f"Sem: {sem.get('sem_number') or '?'} | Batch: {batch.get('batch_name') or '?'}"
        )

    answer = _groq_chat(
        [
            {"role": "system", "content":
             "You answer analytical questions about a list of student projects. "
             "Be concise and direct. Use numbers when relevant. No markdown headers or bullet preambles."},
            {"role": "user", "content":
             f"QUESTION: {question}\n\nPROJECTS ({len(rows)} total):\n" + "\n".join(lines[:150])},
        ],
        max_tokens=350,
    )
    return {"type": "aggregate", "answer": answer.strip(), "total_projects": len(rows)}


def _suggest_rephrasing(original_query: str, applied_filter: dict) -> str:
    raw = _groq_chat(
        [
            {"role": "system", "content":
             "A user searched for student projects but got zero results. "
             "Suggest one simpler or broader rephrasing of their query in a single short sentence. "
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
            {"role": "user", "content": user_msg},
        ],
        json_mode=True,
        max_tokens=300,
    )
    try:
        spec = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(502, "Model returned non-JSON filter spec.")

    intent = spec.pop("intent", "filter")
    aggregate_question = spec.pop("aggregate_question", None)

    if intent == "aggregate":
        return _handle_aggregate(aggregate_question or req.query)

    from project_tracker import db  # late import — avoids circular at module load

    q = db.table("project").select(
        "project_id,title,github,guide,"
        "student(name,usn),"
        "course(course_name,semester(sem_number,batch(batch_name)))"
    )

    if isinstance(spec.get("title"), str) and spec["title"].strip():
        q = q.ilike("title", f"%{spec['title'].strip()}%")
    if isinstance(spec.get("guide_name"), str) and spec["guide_name"].strip():
        q = q.ilike("guide", f"%{spec['guide_name'].strip()}%")
    if isinstance(spec.get("keyword"), str) and spec["keyword"].strip():
        kw = spec["keyword"].strip()
        q = q.or_(f"title.ilike.%{kw}%,github.ilike.%{kw}%,readme_cache.ilike.%{kw}%")

    rows = q.limit(50).execute().data or []

    # Post-filter for nested fields the REST query can't easily constrain
    def keep(p: dict) -> bool:
        course = p.get("course") or {}
        sem = course.get("semester") or {}
        batch = sem.get("batch") or {}
        if isinstance(spec.get("course_name"), str) and spec["course_name"].strip():
            if spec["course_name"].lower() not in (course.get("course_name") or "").lower():
                return False
        if isinstance(spec.get("batch_name"), str) and spec["batch_name"].strip():
            if spec["batch_name"].lower() not in (batch.get("batch_name") or "").lower():
                return False
        if isinstance(spec.get("sem_number"), int):
            if sem.get("sem_number") != spec["sem_number"]:
                return False
        if isinstance(spec.get("student_name"), str) and spec["student_name"].strip():
            needle = spec["student_name"].lower()
            students = p.get("student") or []
            if not any(needle in (s.get("name") or "").lower() for s in students):
                return False
        return True

    filtered = [p for p in rows if keep(p)]
    summary = _build_summary(len(filtered), spec)
    rephrasing = _suggest_rephrasing(req.query, spec) if len(filtered) == 0 else None
    return {
        "type": "filter",
        "filter": spec,
        "count": len(filtered),
        "projects": filtered,
        "summary": summary,
        "rephrasing": rephrasing,
    }


# ───────────────────────── Capability 2: explain README ─────────────────────────

_CACHE_TTL = timedelta(days=7)


def _load_project_with_readme(project_id: str) -> tuple[dict, Optional[str], Optional[str]]:
    from project_tracker import db
    proj = db.table("project").select("*").eq("project_id", project_id).execute()
    if not proj.data:
        raise HTTPException(404, "Project not found.")
    p = proj.data[0]

    # Serve from cache if fresh
    cached_at_raw = p.get("readme_cached_at")
    if p.get("readme_cache") and cached_at_raw:
        try:
            cached_at = datetime.fromisoformat(cached_at_raw.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) - cached_at < _CACHE_TTL:
                return p, p["readme_cache"], None
        except ValueError:
            pass

    # Cache miss — fetch from GitHub
    parsed = parse_repo_url(p.get("github"))
    if not parsed:
        return p, None, "no_github_url"
    readme = fetch_readme(*parsed)
    if not readme:
        return p, None, "readme_unreachable"

    # Persist to cache
    db.table("project").update({
        "readme_cache": readme,
        "readme_cached_at": datetime.now(timezone.utc).isoformat(),
    }).eq("project_id", project_id).execute()

    return p, readme, None


@router.post("/explain/{project_id}")
def chatbot_explain(project_id: str, user: dict = Depends(verify_token)):
    p, readme, reason = _load_project_with_readme(project_id)
    if not readme:
        return {
            "project_id": project_id,
            "summary": None,
            "reason": reason,
            "title": p.get("title"),
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
        "title": p.get("title"),
        "summary": summary.strip(),
        "reason": None,
    }


# ───────────────────────── Capability 5: suggest improvements ─────────────────────────

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
            {"role": "user", "content": body or "an unspecified student project"},
        ],
        json_mode=True,
        max_tokens=200,
    )
    try:
        data = json.loads(raw)
        kws = data.get("keywords") or []
        return [str(k).strip() for k in kws if str(k).strip()][:5]
    except json.JSONDecodeError:
        # Fallback: pull words from title
        return re.findall(r"[A-Za-z][A-Za-z0-9+.-]{2,}", title or "")[:5]


@router.post("/suggest/{project_id}")
def chatbot_suggest(project_id: str, user: dict = Depends(verify_token)):
    p, readme, _reason = _load_project_with_readme(project_id)

    keywords = _extract_keywords(p.get("title") or "", readme)
    if not keywords:
        raise HTTPException(422, "Could not derive keywords for this project.")

    query = " ".join(keywords)
    related = search_repos(query, limit=3)

    related_context_parts: list[str] = []
    related_cards: list[dict] = []
    used = 0
    for r in related:
        full = r.get("full_name") or ""
        if "/" not in full:
            continue
        owner, repo = full.split("/", 1)
        rd = fetch_readme(owner, repo) or ""
        rd_short = truncate_tokens(rd, _RELATED_CAP)
        # respect total cap
        if used + len(rd_short) > _TOTAL_CAP * 4:
            rd_short = rd_short[: max(0, _TOTAL_CAP * 4 - used)]
        used += len(rd_short)
        related_cards.append({
            "name": full,
            "stars": r.get("stargazers_count"),
            "url": r.get("html_url"),
            "description": r.get("description"),
        })
        if rd_short:
            related_context_parts.append(f"### {full}\n{rd_short}")

    own_snippet = truncate_tokens(readme or "", _README_CAP)

    prompt = (
        f"PROJECT TITLE: {p.get('title') or 'untitled'}\n\n"
        f"PROJECT README:\n{own_snippet or '(no README available)'}\n\n"
        f"RELATED REPOS (top by stars for keywords: {', '.join(keywords)}):\n"
        + ("\n\n".join(related_context_parts) or "(none reachable)")
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
        data = json.loads(suggestions_raw)
        suggestions = [str(s).strip() for s in (data.get("suggestions") or []) if str(s).strip()]
    except json.JSONDecodeError:
        suggestions = []

    return {
        "project_id": project_id,
        "title": p.get("title"),
        "keywords": keywords,
        "related": related_cards,
        "suggestions": suggestions[:6],
    }


@router.get("/health")
def chatbot_health():
    return {"groq_configured": bool(_GROQ_KEY), "model": _MODEL}
