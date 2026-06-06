"""
GitHub helpers — README and repo metadata fetch with timeouts and graceful fallback.
Optional GITHUB_TOKEN is read from env to bump unauthenticated 60 req/h limits to 5000/h.
"""

from __future__ import annotations

import os
import re
from typing import Optional

import requests

_GH_TOKEN = os.getenv("GITHUB_TOKEN")
_TIMEOUT = 5  # seconds — hard cap per the spec


def _headers() -> dict:
    h = {"Accept": "application/vnd.github+json", "User-Agent": "project-tracker/1.0"}
    if _GH_TOKEN:
        h["Authorization"] = f"Bearer {_GH_TOKEN}"
    return h


def parse_repo_url(url: Optional[str]) -> Optional[tuple[str, str]]:
    """Pull (owner, repo) out of a GitHub URL. Returns None for empty/non-GitHub URLs."""
    if not url:
        return None
    m = re.search(r"github\.com[:/]+([\w.-]+)/([\w.-]+?)(?:\.git)?(?:/|$)", url.strip())
    if not m:
        return None
    return m.group(1), m.group(2)


def fetch_readme(owner: str, repo: str) -> Optional[str]:
    """Try to fetch README.md via the raw URL. Returns None on any failure."""
    raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/HEAD/README.md"
    try:
        r = requests.get(raw_url, timeout=_TIMEOUT, headers={"User-Agent": "project-tracker/1.0"})
        if r.status_code == 200 and r.text.strip():
            return r.text
    except requests.RequestException:
        pass
    return None


def fetch_repo_meta(owner: str, repo: str) -> Optional[dict]:
    """Fetch repo description + stars + name. Returns None if private/missing."""
    try:
        r = requests.get(
            f"https://api.github.com/repos/{owner}/{repo}",
            timeout=_TIMEOUT, headers=_headers(),
        )
        if r.status_code == 200:
            return r.json()
    except requests.RequestException:
        pass
    return None


def search_repos(query: str, limit: int = 5) -> list[dict]:
    """GitHub repository search by stars. Returns trimmed list (may be empty)."""
    try:
        r = requests.get(
            "https://api.github.com/search/repositories",
            params={"q": query, "sort": "stars", "order": "desc", "per_page": limit},
            timeout=_TIMEOUT, headers=_headers(),
        )
        if r.status_code != 200:
            return []
        return r.json().get("items", []) or []
    except requests.RequestException:
        return []


def truncate_tokens(text: str, max_tokens: int) -> str:
    """Coarse character-based truncation (~4 chars/token).
    Cheap and deterministic — avoids pulling in tiktoken just for this.
    """
    if not text:
        return ""
    cap = max_tokens * 4
    return text if len(text) <= cap else text[:cap] + "\n…[truncated]"
