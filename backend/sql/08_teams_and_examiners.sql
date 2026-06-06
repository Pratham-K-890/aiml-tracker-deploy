-- 08_teams_and_examiners.sql
-- Adds team_number to project; creates project_examiner junction table.
-- Run in Supabase SQL Editor after 07_project_active.sql.

-- team_number for display ordering and Excel upsert key
ALTER TABLE project ADD COLUMN IF NOT EXISTS team_number INTEGER;
CREATE INDEX IF NOT EXISTS idx_project_team_number ON project(course_id, team_number);

-- Examiners: max 2 per project (enforced in API), must be teacher/hod/admin
CREATE TABLE IF NOT EXISTS project_examiner (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID        NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_examiner_project ON project_examiner(project_id);
CREATE INDEX IF NOT EXISTS idx_examiner_user    ON project_examiner(user_id);
ALTER TABLE project_examiner DISABLE ROW LEVEL SECURITY;
