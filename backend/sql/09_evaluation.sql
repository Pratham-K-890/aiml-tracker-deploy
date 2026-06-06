-- 09_evaluation.sql
-- Adds evaluation_review (3 per course, locked by default) and
-- evaluation_mark (per-student rubric marks by guide or evaluator).
-- Run after 08_teams_and_examiners.sql.

-- ── evaluation_review ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS evaluation_review (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     UUID    NOT NULL REFERENCES course(course_id) ON DELETE CASCADE,
  review_number INT     NOT NULL CHECK (review_number IN (1, 2, 3)),
  is_locked     BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (course_id, review_number)
);
CREATE INDEX IF NOT EXISTS idx_eval_review_course ON evaluation_review(course_id);
ALTER TABLE evaluation_review DISABLE ROW LEVEL SECURITY;

-- ── evaluation_mark ───────────────────────────────────────────────────────────
-- c1..c5 map to the rubric criteria for that review_number.
-- Review 1 & 2 use c1..c5 (5 criteria × 10 = 50).
-- Review 3 uses c1..c4 (4 criteria × 25 = 100); c5 stays NULL.
CREATE TABLE IF NOT EXISTS evaluation_mark (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  eval_review_id UUID        NOT NULL REFERENCES evaluation_review(id) ON DELETE CASCADE,
  project_id     UUID        NOT NULL REFERENCES project(project_id)   ON DELETE CASCADE,
  student_id     UUID        NOT NULL REFERENCES student(student_id)   ON DELETE CASCADE,
  scorer_id      UUID        NOT NULL REFERENCES profiles(id)          ON DELETE CASCADE,
  scorer_type    TEXT        NOT NULL CHECK (scorer_type IN ('guide', 'evaluator')),
  c1             INT,
  c2             INT,
  c3             INT,
  c4             INT,
  c5             INT,
  submitted_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (eval_review_id, student_id, scorer_id, scorer_type)
);
CREATE INDEX IF NOT EXISTS idx_eval_mark_review  ON evaluation_mark(eval_review_id);
CREATE INDEX IF NOT EXISTS idx_eval_mark_project ON evaluation_mark(project_id);
CREATE INDEX IF NOT EXISTS idx_eval_mark_scorer  ON evaluation_mark(scorer_id);
ALTER TABLE evaluation_mark DISABLE ROW LEVEL SECURITY;

-- ── Back-fill: 3 locked reviews for every existing course ─────────────────────
INSERT INTO evaluation_review (course_id, review_number)
SELECT c.course_id, r.n
FROM   course c
CROSS  JOIN (VALUES (1),(2),(3)) AS r(n)
ON CONFLICT (course_id, review_number) DO NOTHING;
