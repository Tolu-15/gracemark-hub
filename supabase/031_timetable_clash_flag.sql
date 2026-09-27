-- Allow a teacher to be scheduled twice at the same time, but flag it instead of blocking the
-- save. Admins can then see the clash (highlighted red in the UI) and fix it when convenient,
-- rather than being unable to save a timetable in progress. Safe to re-run.

ALTER TABLE public.timetable_slots DROP CONSTRAINT IF EXISTS uq_timetable_teacher_slot;

ALTER TABLE public.timetable_slots ADD COLUMN IF NOT EXISTS has_clash boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_timetable_slots_clash ON public.timetable_slots (academic_session_id, term_code, teacher_user_id, day_of_week, period_id)
  WHERE has_clash;
