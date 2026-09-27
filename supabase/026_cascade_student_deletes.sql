-- Make deleting a student (and its enrollments) cascade to every dependent row.
-- Fixes: "update or delete on table ... violates foreign key constraint
-- attendance_summaries_enrollment_id_fkey". Safe to re-run.
DO $$
DECLARE
  r record;
  cols text;
  refcols text;
BEGIN
  FOR r IN
    SELECT c.oid, c.conname, c.conrelid::regclass AS child, c.confrelid::regclass AS parent,
           c.conkey, c.confkey, c.conrelid, c.confrelid AS parent_oid
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.confdeltype <> 'c'
      AND c.confrelid IN ('public.student_enrollments'::regclass, 'public.students'::regclass)
      AND c.connamespace = 'public'::regnamespace
      -- only columns that are NOT NULL-able children make sense to cascade; nullable
      -- refs (e.g. audit columns) are left alone
      AND NOT EXISTS (
        SELECT 1 FROM unnest(c.conkey) k
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
        WHERE NOT a.attnotnull
      )
  LOOP
    SELECT string_agg(quote_ident(a.attname), ', ') INTO cols
      FROM unnest(r.conkey) k JOIN pg_attribute a ON a.attrelid = r.conrelid AND a.attnum = k;
    SELECT string_agg(quote_ident(a.attname), ', ') INTO refcols
      FROM unnest(r.confkey) k JOIN pg_attribute a ON a.attrelid = r.parent_oid AND a.attnum = k;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.child, r.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES %s (%s) ON DELETE CASCADE',
                   r.child, r.conname, cols, r.parent, refcols);
  END LOOP;
END $$;
