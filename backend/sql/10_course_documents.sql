-- 10_course_documents.sql
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS course_document (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    UUID        NOT NULL REFERENCES course(course_id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  file_url     TEXT        NOT NULL,
  file_type    TEXT,
  file_size    BIGINT,
  uploaded_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_course_doc_course ON course_document(course_id);
ALTER TABLE course_document DISABLE ROW LEVEL SECURITY;
