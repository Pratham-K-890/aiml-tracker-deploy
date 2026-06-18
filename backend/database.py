"""
SQLite database layer for Docker/local deployment.
Replaces supabase-py. Thread-local connections, WAL mode.
"""
from __future__ import annotations

import os
import sqlite3
import threading
import uuid

DB_PATH = os.getenv("DB_PATH", "/data/tracker.db")

_local = threading.local()


def get_conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA foreign_keys=ON")
    return _local.conn


def new_id() -> str:
    return str(uuid.uuid4())


def fetchall(sql: str, params: tuple = ()) -> list[dict]:
    cur = get_conn().execute(sql, params)
    return [dict(r) for r in cur.fetchall()]


def fetchone(sql: str, params: tuple = ()) -> dict | None:
    cur = get_conn().execute(sql, params)
    row = cur.fetchone()
    return dict(row) if row else None


def execute(sql: str, params: tuple = ()) -> sqlite3.Cursor:
    conn = get_conn()
    cur = conn.execute(sql, params)
    conn.commit()
    return cur


def executemany(sql: str, params_list: list) -> None:
    conn = get_conn()
    conn.executemany(sql, params_list)
    conn.commit()


def init_db() -> None:
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS profiles (
            id            TEXT PRIMARY KEY,
            email         TEXT UNIQUE NOT NULL,
            name          TEXT,
            usn           TEXT,
            role          TEXT NOT NULL DEFAULT 'student',
            approved      INTEGER NOT NULL DEFAULT 1,
            password_hash TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS batch (
            batch_id   TEXT PRIMARY KEY,
            batch_name TEXT NOT NULL,
            year       INTEGER
        );

        CREATE TABLE IF NOT EXISTS semester (
            semester_id    TEXT PRIMARY KEY,
            batch_id       TEXT NOT NULL REFERENCES batch(batch_id) ON DELETE CASCADE,
            sem_number     INTEGER NOT NULL,
            project_status TEXT CHECK(project_status IN ('mini','major')) DEFAULT NULL,
            project_active INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS course (
            course_id   TEXT PRIMARY KEY,
            semester_id TEXT NOT NULL REFERENCES semester(semester_id) ON DELETE CASCADE,
            course_name TEXT NOT NULL,
            course_code TEXT
        );

        CREATE TABLE IF NOT EXISTS coordinator (
            user_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            course_id TEXT NOT NULL REFERENCES course(course_id) ON DELETE CASCADE,
            PRIMARY KEY (user_id, course_id)
        );

        CREATE TABLE IF NOT EXISTS project (
            project_id       TEXT PRIMARY KEY,
            course_id        TEXT NOT NULL REFERENCES course(course_id) ON DELETE CASCADE,
            title            TEXT,
            github           TEXT,
            guide            TEXT,
            guide_id         TEXT REFERENCES profiles(id) ON DELETE SET NULL,
            team_number      INTEGER,
            readme_cache     TEXT,
            readme_cached_at TEXT
        );

        CREATE TABLE IF NOT EXISTS student (
            student_id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
            usn        TEXT,
            name       TEXT
        );

        CREATE TABLE IF NOT EXISTS project_examiner (
            id         TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
            user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(project_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS review (
            review_id    TEXT PRIMARY KEY,
            course_id    TEXT NOT NULL REFERENCES course(course_id) ON DELETE CASCADE,
            scheduled_by TEXT REFERENCES profiles(id),
            title        TEXT NOT NULL,
            date         TEXT NOT NULL,
            description  TEXT,
            document_url TEXT
        );

        CREATE TABLE IF NOT EXISTS evaluation_review (
            id            TEXT PRIMARY KEY,
            course_id     TEXT NOT NULL REFERENCES course(course_id) ON DELETE CASCADE,
            review_number INTEGER NOT NULL,
            is_locked     INTEGER NOT NULL DEFAULT 1,
            UNIQUE(course_id, review_number)
        );

        CREATE TABLE IF NOT EXISTS evaluation_mark (
            id             TEXT PRIMARY KEY,
            eval_review_id TEXT NOT NULL REFERENCES evaluation_review(id) ON DELETE CASCADE,
            project_id     TEXT NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
            student_id     TEXT NOT NULL REFERENCES student(student_id) ON DELETE CASCADE,
            scorer_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            scorer_type    TEXT NOT NULL,
            c1             INTEGER,
            c2             INTEGER,
            c3             INTEGER,
            c4             INTEGER,
            c5             INTEGER,
            submitted_at   TEXT,
            UNIQUE(eval_review_id, student_id, scorer_id, scorer_type)
        );

        CREATE TABLE IF NOT EXISTS course_document (
            id          TEXT PRIMARY KEY,
            course_id   TEXT NOT NULL REFERENCES course(course_id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            file_url    TEXT NOT NULL,
            file_type   TEXT,
            file_size   INTEGER,
            uploaded_by TEXT REFERENCES profiles(id),
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)
    conn.commit()
