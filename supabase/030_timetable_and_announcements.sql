-- Timetable + announcements. Everything is scoped to an academic session and term.
-- All access goes through server routes (service role), so RLS is enabled with no
-- policies: the browser cannot read or write these tables directly. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Timetable
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timetable_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position integer NOT NULL UNIQUE CHECK (position > 0),
  label text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_break boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

INSERT INTO public.timetable_periods (position, label, start_time, end_time, is_break)
SELECT * FROM (VALUES
  (1, 'Period 1', '08:00'::time, '08:40'::time, false),
  (2, 'Period 2', '08:40'::time, '09:20'::time, false),
  (3, 'Period 3', '09:20'::time, '10:00'::time, false),
  (4, 'Short Break', '10:00'::time, '10:20'::time, true),
  (5, 'Period 4', '10:20'::time, '11:00'::time, false),
  (6, 'Period 5', '11:00'::time, '11:40'::time, false),
  (7, 'Period 6', '11:40'::time, '12:20'::time, false),
  (8, 'Long Break', '12:20'::time, '12:50'::time, true),
  (9, 'Period 7', '12:50'::time, '13:30'::time, false),
  (10, 'Period 8', '13:30'::time, '14:10'::time, false)
) AS v(position, label, start_time, end_time, is_break)
WHERE NOT EXISTS (SELECT 1 FROM public.timetable_periods);

CREATE TABLE IF NOT EXISTS public.timetable_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_session_id uuid NOT NULL REFERENCES public.academic_sessions(id) ON DELETE CASCADE,
  term_code text NOT NULL CHECK (term_code IN ('term1', 'term2', 'term3')),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 5),
  period_id uuid NOT NULL REFERENCES public.timetable_periods(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  teacher_user_id uuid NOT NULL,
  room text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- a class has one lesson per period
  CONSTRAINT uq_timetable_class_slot UNIQUE (academic_session_id, term_code, class_id, day_of_week, period_id),
  -- a teacher cannot be in two places at once: this is the clash guard
  CONSTRAINT uq_timetable_teacher_slot UNIQUE (academic_session_id, term_code, teacher_user_id, day_of_week, period_id)
);

CREATE INDEX IF NOT EXISTS idx_timetable_slots_lookup ON public.timetable_slots (academic_session_id, term_code, class_id);
CREATE INDEX IF NOT EXISTS idx_timetable_slots_teacher ON public.timetable_slots (academic_session_id, term_code, teacher_user_id);

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_session_id uuid NOT NULL REFERENCES public.academic_sessions(id) ON DELETE CASCADE,
  term_code text NOT NULL CHECK (term_code IN ('term1', 'term2', 'term3')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  audience text NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'students', 'teachers')),
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  pinned boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  author_user_id uuid,
  author_name text,
  author_role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_session ON public.announcements (academic_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_class ON public.announcements (class_id);

CREATE TABLE IF NOT EXISTS public.announcement_reads (
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  reader_auth_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, reader_auth_id)
);

ALTER TABLE public.timetable_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetable_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;
