-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- 1. Profiles table (one row per Supabase auth user)
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'lecturer'
               CHECK (role IN ('admin', 'lecturer', 'student')),
  approved   BOOLEAN NOT NULL DEFAULT FALSE,
  name       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- If profiles table already exists, add the approved column
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT FALSE;

-- Admins are always approved
UPDATE profiles SET approved = TRUE WHERE role = 'admin';

-- 2. Add course_code column to existing course table
ALTER TABLE course ADD COLUMN IF NOT EXISTS course_code TEXT;

-- 3. After running this file, promote one user to admin:
--    Replace the UUID and email with the actual admin's Supabase user ID.
--
--    INSERT INTO profiles (id, email, role)
--    VALUES ('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 'admin@example.com', 'admin')
--    ON CONFLICT (id) DO UPDATE SET role = 'admin';
--
--    Find your user ID in Supabase: Authentication → Users → copy the UUID column.
