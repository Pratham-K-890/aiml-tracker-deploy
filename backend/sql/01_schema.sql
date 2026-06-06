-- ============================================================
-- Project Tracker — core schema
-- Run this FIRST, then 02_coordinator.sql
-- ============================================================

-- batch: e.g. "2024-2028"
create table if not exists batch (
  batch_id    uuid primary key default gen_random_uuid(),
  batch_name  text not null,
  year        integer
);
create index if not exists idx_batch_name on batch(batch_name);
alter table batch disable row level security;

-- semester: belongs to a batch (sem_number 1-8)
create table if not exists semester (
  semester_id uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references batch(batch_id) on delete cascade,
  sem_number  integer not null check (sem_number between 1 and 8),
  unique (batch_id, sem_number)
);
create index if not exists idx_semester_batch on semester(batch_id);
alter table semester disable row level security;

-- course: belongs to a semester
create table if not exists course (
  course_id   uuid primary key default gen_random_uuid(),
  semester_id uuid not null references semester(semester_id) on delete cascade,
  course_name text not null
);
create index if not exists idx_course_semester on course(semester_id);
alter table course disable row level security;

-- project: belongs to a course, optional github + guide
create table if not exists project (
  project_id  uuid primary key default gen_random_uuid(),
  course_id   uuid not null references course(course_id) on delete cascade,
  title       text,
  github      text,
  guide       text
);
create index if not exists idx_project_course on project(course_id);
alter table project disable row level security;

-- student: member of a project team (max 4 per project enforced in app layer)
create table if not exists student (
  student_id  uuid primary key default gen_random_uuid(),
  project_id  uuid not null references project(project_id) on delete cascade,
  usn         text,
  name        text
);
create index if not exists idx_student_project on student(project_id);
alter table student disable row level security;
