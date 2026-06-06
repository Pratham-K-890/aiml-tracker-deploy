-- 04_refactor.sql — Hierarchy & roles refactor
-- Run in Supabase SQL Editor AFTER all previous migrations.

-- 1. Update profiles role constraint: add hod + teacher, remove lecturer
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('hod', 'admin', 'teacher', 'student'));

-- 2. Migrate existing data: lecturer → teacher
UPDATE profiles SET role = 'teacher' WHERE role = 'lecturer';

-- 3. Add usn column to profiles (for student login accounts)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS usn TEXT;

-- 4. Add guide_id FK to project (references profiles, not auth.users directly)
ALTER TABLE project
  ADD COLUMN IF NOT EXISTS guide_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_project_guide ON project(guide_id);

-- 5. Create review table (per course, scheduled by coordinator)
CREATE TABLE IF NOT EXISTS review (
  review_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     UUID NOT NULL REFERENCES course(course_id) ON DELETE CASCADE,
  scheduled_by  UUID NOT NULL,
  title         TEXT NOT NULL,
  date          DATE NOT NULL,
  description   TEXT,
  document_url  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_review_course ON review(course_id);
ALTER TABLE review DISABLE ROW LEVEL SECURITY;

-- 6. Ensure name column exists on profiles (may already exist from 02_roles.sql)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS name TEXT;
