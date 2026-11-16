-- Called only by the already authorized score-entry API. No changes to existing rows on installation.
BEGIN;
CREATE OR REPLACE FUNCTION public.save_score_sheet(
  p_records jsonb, p_delete_ids uuid[], p_class uuid, p_subject uuid, p_session text, p_term text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  existing public.results%ROWTYPE;
  saved_count int;
BEGIN
  FOR existing IN SELECT * FROM public.results WHERE id = ANY(p_delete_ids) ORDER BY id FOR UPDATE LOOP
    IF existing.class_id IS DISTINCT FROM p_class OR existing.subject_id IS DISTINCT FROM p_subject
       OR existing.session IS DISTINCT FROM p_session OR existing.term::text IS DISTINCT FROM p_term
       OR existing.score_breakdown IS NULL
       OR 'published' IN (existing.pr1_status::text, existing.pr2_status::text, existing.pr3_status::text, existing.tr_status::text) THEN
      RAISE EXCEPTION 'This score changed or is protected. Reload the sheet.' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM public.results WHERE id = existing.id;
  END LOOP;

  INSERT INTO public.results AS stored
    (student_id, class_id, subject_id, session, academic_session_id, term, teacher_id,
     cw, hw, test, project, exam, grade, score_breakdown, status)
  SELECT student_id, class_id, subject_id, session, academic_session_id, term, teacher_id,
         cw, hw, test, project, exam, grade, score_breakdown, status
  FROM jsonb_populate_recordset(NULL::public.results, p_records)
  WHERE class_id = p_class AND subject_id = p_subject AND session = p_session AND term::text = p_term
  ORDER BY student_id
  ON CONFLICT (student_id, subject_id, term, session) DO UPDATE SET
    class_id = excluded.class_id, academic_session_id = excluded.academic_session_id,
    teacher_id = coalesce(excluded.teacher_id, stored.teacher_id), cw = excluded.cw, hw = excluded.hw,
    test = excluded.test, project = excluded.project, exam = excluded.exam,
    grade = excluded.grade, score_breakdown = excluded.score_breakdown, status = excluded.status,
    return_reason = CASE WHEN excluded.status::text = 'submitted' THEN NULL ELSE stored.return_reason END
  WHERE stored.class_id IS NULL OR stored.class_id = excluded.class_id;
  GET DIAGNOSTICS saved_count = ROW_COUNT;
  IF saved_count <> jsonb_array_length(p_records) THEN
    RAISE EXCEPTION 'Score sheet context changed. Reload the sheet.' USING ERRCODE = 'P0001';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.save_score_sheet(jsonb, uuid[], uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_score_sheet(jsonb, uuid[], uuid, uuid, text, text) TO service_role;
COMMIT;
