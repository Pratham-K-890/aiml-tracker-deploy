-- 06_project_status.sql
-- Adds project_status to semester so coordinators can signal mini/major project activity.
-- Run in Supabase SQL Editor.

ALTER TABLE semester
  ADD COLUMN IF NOT EXISTS project_status TEXT
  CHECK (project_status IN ('mini', 'major'));
