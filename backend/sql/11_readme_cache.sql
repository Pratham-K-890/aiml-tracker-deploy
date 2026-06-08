-- 11_readme_cache.sql
-- Run in Supabase SQL Editor.
-- Adds README caching columns to the project table so the chatbot
-- reads from DB instead of hitting GitHub on every explain/suggest call.

ALTER TABLE project
  ADD COLUMN IF NOT EXISTS readme_cache      TEXT,
  ADD COLUMN IF NOT EXISTS readme_cached_at  TIMESTAMPTZ;
