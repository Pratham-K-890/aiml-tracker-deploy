-- Coordinator role: one Supabase auth user is the coordinator of one course
-- (and therefore manages every project under that course).
-- Run after the initial schema migration.

create table if not exists coordinator (
  user_id    uuid not null,                                  -- references auth.users(id)
  course_id  uuid not null references course(course_id) on delete cascade,
  primary key (user_id, course_id)
);

create index if not exists idx_coordinator_course on coordinator(course_id);
create index if not exists idx_coordinator_user   on coordinator(user_id);

-- RLS stays disabled — backend uses service-role key + JWT-checked endpoints.
alter table coordinator disable row level security;
