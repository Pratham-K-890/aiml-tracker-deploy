-- 05_ensure_schema.sql
-- Idempotent catch-up migration — safe to run even if earlier migrations were skipped.
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query).

-- ── 1. profiles: widen role constraint to include hod + teacher ───────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('hod', 'admin', 'teacher', 'student'));

-- Migrate any legacy 'lecturer' rows
UPDATE profiles SET role = 'teacher' WHERE role = 'lecturer';

-- ── 2. profiles: columns added in later migrations ────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS name     TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS usn      TEXT;

-- Auto-approve existing admin accounts
UPDATE profiles SET approved = TRUE WHERE role = 'admin';

-- ── 3. course: course_code column ─────────────────────────────────────────────
ALTER TABLE course ADD COLUMN IF NOT EXISTS course_code TEXT;

-- ── 4. project: guide_id FK → profiles ───────────────────────────────────────
ALTER TABLE project
  ADD COLUMN IF NOT EXISTS guide_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_project_guide ON project(guide_id);

-- ── 5. coordinator table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coordinator (
  user_id   UUID NOT NULL,
  course_id UUID NOT NULL REFERENCES course(course_id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, course_id)
);
CREATE INDEX IF NOT EXISTS idx_coordinator_course ON coordinator(course_id);
CREATE INDEX IF NOT EXISTS idx_coordinator_user   ON coordinator(user_id);
ALTER TABLE coordinator DISABLE ROW LEVEL SECURITY;

-- ── 6. review table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS review (
  review_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    UUID        NOT NULL REFERENCES course(course_id) ON DELETE CASCADE,
  scheduled_by UUID        NOT NULL,
  title        TEXT        NOT NULL,
  date         DATE        NOT NULL,
  description  TEXT,
  document_url TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_review_course ON review(course_id);
ALTER TABLE review DISABLE ROW LEVEL SECURITY;

-- ── 7. Disable RLS on all core tables (service key bypasses anyway, but belt+suspenders) ──
ALTER TABLE batch        DISABLE ROW LEVEL SECURITY;
ALTER TABLE semester     DISABLE ROW LEVEL SECURITY;
ALTER TABLE course       DISABLE ROW LEVEL SECURITY;
ALTER TABLE project      DISABLE ROW LEVEL SECURITY;
ALTER TABLE student      DISABLE ROW LEVEL SECURITY;
