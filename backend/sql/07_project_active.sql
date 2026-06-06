-- 07_project_active.sql
-- Separates "what type of project" from "is it currently running".
-- Run in Supabase SQL Editor.

ALTER TABLE semester
  ADD COLUMN IF NOT EXISTS project_active BOOLEAN NOT NULL DEFAULT FALSE;
