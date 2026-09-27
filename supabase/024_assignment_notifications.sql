-- ==============================================================================
-- MIGRATION: 024_assignment_notifications.sql
-- Tracks which teacher assignment changes have already been emailed, so the
-- admin "Send assignment update" button only notifies teachers whose
-- assignments changed since the last send.
--   notified_at      : teacher was told about this (new) assignment
--   end_notified_at  : teacher was told this assignment ended
-- ==============================================================================

ALTER TABLE public.subject_teacher_assignments
  ADD COLUMN IF NOT EXISTS notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS end_notified_at timestamptz;

ALTER TABLE public.class_teacher_assignments
  ADD COLUMN IF NOT EXISTS notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS end_notified_at timestamptz;

-- Existing assignments were communicated before this feature existed.
UPDATE public.subject_teacher_assignments
  SET notified_at = COALESCE(notified_at, now()),
      end_notified_at = CASE WHEN status <> 'active' THEN COALESCE(end_notified_at, now()) END
  WHERE notified_at IS NULL;

UPDATE public.class_teacher_assignments
  SET notified_at = COALESCE(notified_at, now()),
      end_notified_at = CASE WHEN status <> 'active' THEN COALESCE(end_notified_at, now()) END
  WHERE notified_at IS NULL;

NOTIFY pgrst, 'reload schema';
