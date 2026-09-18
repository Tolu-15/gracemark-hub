# Gracemark Academy — Testing Templates & Instructions

This directory contains pre-configured Excel (`.xlsx`) and CSV (`.csv`) templates designed specifically for testing **Teachers**, **Students**, and **Scores** (both 3-Week Progress Reports and Terminal Examinations).

---

## Template Files Overview

| File | Purpose | Format | Where to Use in App |
| :--- | :--- | :--- | :--- |
| **`1_students_bulk_upload.xlsx`** | Bulk register students with classes & admission numbers | `.xlsx` & `.csv` | **Admin Portal** -> Students (`/admin/students/`) -> **"Bulk Upload"** |
| **`2_teachers_roster.xlsx`** | Reference list of teachers, emails, subject & class assignments | `.xlsx` & `.csv` | **Admin Portal** -> Teachers (`/admin/teachers/`) -> **"Add Teacher"** |
| **`3_assessment_score_upload.xlsx`** | Upload single assessment / test scores (e.g., PR Checkpoints) | `.xlsx` & `.csv` | **Teacher Portal** -> Assessments (`/teacher/assessments/`) -> **"Upload Scores"** |
| **`4_master_term_scores_template.xlsx`**| Master grading sheet showing full CW, HW, 3 PR intervals & Exam | `.xlsx` & `.csv` | Reference for full continuous assessment breakdown |

---

## Step-by-Step Testing Workflow

### Step 1: Upload Students (Admin Portal)
1. Log in to the Admin Portal (or navigate to `http://127.0.0.1:5502/admin/students/`).
2. Click the **"Bulk Upload"** button at the top right.
3. Select **`1_students_bulk_upload.xlsx`** (or `1_students_bulk_upload.csv`).
4. The system will automatically:
   - Ensure the classes exist (`JSS 1`, `JSS 2`, `SSS 1 Science`, `SSS 2 Science`, etc.).
   - Create student authentication accounts with default password: **`gracemark`**.
   - Assign their admission numbers (e.g. `GM/2025/001`).

### Step 2: Add & Assign Teachers (Admin Portal)
1. Go to `http://127.0.0.1:5502/admin/teachers/`.
2. Click **"Add Teacher"**.
3. Use the details from **`2_teachers_roster.xlsx`**, for example:
   - **Name**: `Mr. Babatunde Adeyemi`
   - **Email**: `adeyemi.maths@gracemark.sch.ng`
   - **Password**: `gracemark2026!`
   - **Class Assignment**: `JSS 1` & `SSS 2 Science`
   - **Subject Assignment**: `Mathematics`
4. Click **Save**. The teacher can now log in at `/teacher/` using these credentials.

### Step 3: Enter Scores (Teacher Portal)
You have two ways to add scores:
- **Option A (Interactive Gradebook)**:
  1. Log in as a teacher (or go to `http://127.0.0.1:5502/teacher/score-entry.html` or `/teacher/gradebook.html`).
  2. Select Class (e.g. `JSS 1`), Subject (`Mathematics`), and Term (`1st Term`).
  3. Enter CW1–CW5, HW1–HW5, Test 1 (/15), Test 2 (/15), Test 3 (/30), Project (/5), and Exam (/70).
  4. Click **Save Draft** or **Publish to Admin**.
- **Option B (Assessment CSV Upload)**:
  1. Go to `http://127.0.0.1:5502/teacher/assessments/`.
  2. Click **Record Assessment** -> choose class, subject, and assessment title.
  3. Under Upload Scores, drag & drop **`3_assessment_score_upload.xlsx`**.
  4. Click **Save Scores**.

### Step 4: View & Print Reports (Student View)
1. Go to student login or open student dashboard: `http://127.0.0.1:5502/student/`.
2. Login with student admission number (e.g., `GM/2025/001`) and password: **`gracemark`**.
3. Click **"View Full Terminal Sheet"**:
   - **Terminal Report (TR)**: View full terminal table matching the official TR1–TR3 Excel template, class averages, high/low, personal traits, and promotion status.
   - **Progress Report (PR)**: Toggle to **Progress Report (PR)** and switch between:
     - `PR 1 (Weeks 1 – 3)`
     - `PR 2 (Weeks 4 – 6)`
     - `PR 3 (Weeks 7 – 9)`
   - Click **Print** to generate an A4 sheet.

---

## How to Remove All Test Data Later

When you are done testing, run the cleanup script in your Supabase SQL Editor:
```sql
BEGIN;
DELETE FROM public.results WHERE student_id IN (SELECT id FROM public.students WHERE admission_no LIKE 'GM/20%');
DELETE FROM public.attendance WHERE student_id IN (SELECT id FROM public.students WHERE admission_no LIKE 'GM/20%');
DELETE FROM public.student_evaluations WHERE student_id IN (SELECT id FROM public.students WHERE admission_no LIKE 'GM/20%');
DELETE FROM public.students WHERE admission_no LIKE 'GM/20%';
DELETE FROM public.teacher_classes WHERE teacher_id IN (SELECT id FROM public.teachers WHERE email LIKE '%@gracemark.sch.ng');
DELETE FROM public.teacher_subjects WHERE teacher_id IN (SELECT id FROM public.teachers WHERE email LIKE '%@gracemark.sch.ng');
DELETE FROM public.teachers WHERE email LIKE '%@gracemark.sch.ng';
DELETE FROM public.users WHERE email LIKE '%@gracemark.sch.ng';
COMMIT;
```
Or execute `cleanup_test_data.sql` located in this directory.
