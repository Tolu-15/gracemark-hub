# Supabase policy inventory

Static inventory of 71 table names declared in the checked-in SQL. Each column lists source files by migration number or basename. Multiple baselines and dynamic SQL exist. A literal match is evidence of source coverage only. Actual deployment order, inherited grants, policy combinations, table ownership, views, storage buckets and RPC execute privileges require the installed database catalog.

| Table | Explicit RLS enable statements | Explicit policy definitions |
| --- | --- | --- |
| `academic_sessions` | gracemark_merged_schema, payment_balance_receipts_fix, reset_and_dynamic_sessions, school_finance_admissions | reset_and_dynamic_sessions, schema_v2_canonical, school_finance_admissions |
| `academic_terms` | gracemark_merged_schema, payment_balance_receipts_fix, school_finance_admissions | schema_v2_canonical, school_finance_admissions |
| `admin_otp_sessions` | 015 | 015, schema_v2_canonical |
| `admission_forms` | school_finance_admissions | 013, schema_v2_canonical, school_finance_admissions |
| `admission_payments` | 011, 012, school_finance_admissions | 011, 012, schema_v2_canonical, school_finance_admissions |
| `admissions` | 011, 012, 014, gracemark_merged_schema, payment_admissions | 011, 012, 014, gracemark_merged_schema, payment_admissions, schema_v2_canonical |
| `admissions_audit` | gracemark_merged_schema, payment_admissions | gracemark_merged_schema, payment_admissions, schema_v2_canonical |
| `alumni_students` | cbt_extensions, gracemark_merged_schema | 013, cbt_extensions, gracemark_merged_schema, schema_v2_canonical |
| `announcement_reads` | 030 | No literal match |
| `announcements` | 030 | No literal match |
| `app_settings` | gracemark_merged_schema, rls | 013, gracemark_merged_schema, patch_existing, rls, schema_v2_canonical |
| `assessment_answers` | 013, gracemark_merged_schema, quiz_module | 013, gracemark_merged_schema, quiz_module |
| `assessment_grading_rules` | cbt_automation, gracemark_merged_schema | 013, cbt_automation, gracemark_merged_schema |
| `assessment_questions` | 013, gracemark_merged_schema, quiz_module | 013, gracemark_merged_schema, quiz_module |
| `assessment_submissions` | 013, gracemark_merged_schema, quiz_module | 013, gracemark_merged_schema, quiz_module |
| `assessments` | 013, gracemark_merged_schema, quiz_module | 013, gracemark_merged_schema, quiz_module |
| `attendance` | gracemark_merged_schema, rls | 013, 018, gracemark_merged_schema, rls |
| `attendance_records` | 012 | 012, 018, schema_v2_canonical |
| `attendance_summaries` | No literal match | schema_v2_canonical |
| `audit_logs` | 029 | 029 |
| `cbt_attempt_history` | cbt_automation, gracemark_merged_schema | 013, cbt_automation, gracemark_merged_schema |
| `cbt_exams` | 011, forms_and_exams | 011, forms_and_exams, schema_v2_canonical |
| `cbt_questions` | 011, forms_and_exams | 011, forms_and_exams, schema_v2_canonical |
| `cbt_score_scaling` | cbt_automation, gracemark_merged_schema | 013, cbt_automation, gracemark_merged_schema |
| `cbt_sessions` | 033 | 033 |
| `cbt_submissions` | 011, forms_and_exams | 011, forms_and_exams, schema_v2_canonical |
| `class_averages` | 013, gracemark_merged_schema, rls | 013, gracemark_merged_schema, rls |
| `class_teacher_assignments` | 010 | 010, schema_v2_canonical |
| `classes` | 013, gracemark_merged_schema, rls | 013, gracemark_merged_schema, rls, schema_v2_canonical |
| `custom_forms` | 011, forms_and_exams | 011, forms_and_exams |
| `fee_structures` | gracemark_merged_schema, payment_admissions, payment_balance_receipts_fix, school_finance_admissions | 013, gracemark_merged_schema, payment_admissions, payment_balance_receipts_fix, schema_v2_canonical, school_finance_admissions |
| `feedback_submissions` | 016 | 016 |
| `form_submissions` | 011, 012, 014, forms_and_exams | 011, 012, 014, forms_and_exams |
| `notifications` | 032 | 032 |
| `payment_config` | gracemark_merged_schema, payment_admissions | gracemark_merged_schema, payment_admissions |
| `payment_gateway_configs` | No literal match | schema_v2_canonical |
| `payment_invoices` | gracemark_merged_schema, payment_admissions, payment_balance_receipts_fix, school_finance_admissions | gracemark_merged_schema, payment_admissions, payment_balance_receipts_fix, payment_rpc, schema_v2_canonical, school_finance_admissions |
| `payment_records` | gracemark_merged_schema, payment_admissions, payment_balance_receipts_fix, school_finance_admissions | gracemark_merged_schema, payment_admissions, payment_balance_receipts_fix, payment_rpc, school_finance_admissions |
| `payment_transactions` | No literal match | schema_v2_canonical |
| `portal_access_settings` | gracemark_merged_schema, payment_balance_receipts_fix, school_finance_admissions | gracemark_merged_schema, payment_balance_receipts_fix, schema_v2_canonical, school_finance_admissions |
| `promotions` | cbt_extensions, gracemark_merged_schema | cbt_extensions, gracemark_merged_schema, schema_v2_canonical |
| `published_snapshots` | 012 | 008, 012 |
| `push_subscriptions` | 032 | 032 |
| `result_signature_stamps` | 012 | 012 |
| `result_snapshots` | No literal match | 040, schema_v2_canonical |
| `results` | 013, 042, gracemark_merged_schema, rls | 008, 013, 042, gracemark_merged_schema, patch_existing, quiz_module, rls, schema_v2_canonical |
| `schools` | 013, gracemark_merged_schema, rls | 013, gracemark_merged_schema, rls |
| `scratch_card_failures` | 039 | No literal match |
| `scratch_card_purchases` | 039 | No literal match |
| `scratch_card_views` | 039 | No literal match |
| `scratch_cards` | 039 | No literal match |
| `sections` | 010 | 010, schema_v2_canonical |
| `signatures` | 012 | 012, schema_v2_canonical |
| `student_badges` | 035 | 035 |
| `student_enrollments` | 010 | 010, 013, schema_v2_canonical |
| `student_evaluations` | cbt_extensions, gracemark_merged_schema | cbt_extensions, gracemark_merged_schema, schema_v2_canonical |
| `student_portal_access_logs` | 012, school_finance_admissions | 012, schema_v2_canonical |
| `student_subject_enrollments` | 005, 011, 016 | 005, 011, 016, schema_v2_canonical |
| `student_subject_optouts` | 022, 042 | 022, 042 |
| `students` | 013, forms_and_exams, gracemark_merged_schema, rls | 013, forms_and_exams, gracemark_merged_schema, rls, schema_v2_canonical |
| `subject_group_subjects` | 022 | 022 |
| `subject_groups` | 022 | 022 |
| `subject_teacher_assignments` | 010 | 010, schema_v2_canonical |
| `subjects` | 013, gracemark_merged_schema, rls | 013, gracemark_merged_schema, rls, schema_v2_canonical |
| `system_settings` | 041 | No literal match |
| `teacher_assignments` | 013, gracemark_merged_schema, rls | 013, gracemark_merged_schema, rls |
| `terms` | 012 | 012 |
| `timetable_periods` | 030 | No literal match |
| `timetable_slots` | 030 | No literal match |
| `uploaded_scores` | gracemark_merged_schema, quiz_module | 013, gracemark_merged_schema, quiz_module |
| `users` | 012, forms_and_exams | 012, forms_and_exams, schema_v2_canonical |

## Verify the installed catalog in staging

Run these read-only queries using the database SQL editor. Inspect permissive policies together, including any legacy grants. Treat a table visible through public RPCs or views as a separate access path. Use synthetic student, teacher and admin sessions to test the effective result.

```sql
select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public','storage') and c.relkind in ('r','p') order by 1,2;
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname in ('public','storage') order by 1,2,3;
select table_schema, table_name, grantee, privilege_type from information_schema.role_table_grants
where grantee in ('anon','authenticated','PUBLIC') and table_schema in ('public','storage') order by 1,2,3;
select p.oid::regprocedure, p.prosecdef, p.proconfig,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1;
select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id;
```
