-- Run in Supabase SQL Editor after 02_roles.sql

-- Add approval column (default FALSE so all new registrations start as pending)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT FALSE;

-- Approve all existing admin accounts
UPDATE profiles SET approved = TRUE WHERE role = 'admin';

-- If you want to auto-approve all existing lecturer/student accounts created before this migration:
-- UPDATE profiles SET approved = TRUE;
