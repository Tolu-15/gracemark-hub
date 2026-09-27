export type UserRole = "admin" | "teacher" | "student";

export interface UserProfile {
  id: string;
  auth_id: string;
  email: string | null;
  display_name: string | null;
  role: UserRole;
  created_at?: string;
}

export interface School {
  id: string;
  name: string;
  session: string;
  created_at?: string;
}

export interface ClassRecord {
  id: string;
  name: string;
  session?: string;
  school_id?: string;
  created_at?: string;
}

export type SchoolClass = ClassRecord;

export interface SubjectRecord {
  id: string;
  name: string;
  created_at?: string;
}

export type Subject = SubjectRecord;

export interface StudentRecord {
  id: string;
  class_id: string;
  user_id?: string;
  admission_no: string;
  name: string;
  gender?: string | null;
  dob?: string | null;
  guardian_name?: string | null;
  guardian_phone?: string | null;
  portal_access_status?: "active" | "locked" | null;
  portal_lock_reason?: string | null;
  created_at?: string;
  users?: any;
  classes?: any;
}

export type Student = StudentRecord;

export interface ResultRecord {
  id: string;
  student_id: string;
  subject_id: string;
  class_id?: string;
  term: string;
  session?: string;
  status: string;
  submitted_by?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  cw: number;
  hw: number;
  test: number;
  project: number;
  exam: number;
  score_breakdown?: any;
  total: number;
  grade: string;
  remark?: string;
  pr1_status?: string | null;
  pr2_status?: string | null;
  pr3_status?: string | null;
  tr_status?: string | null;
  return_reason?: string | null;
  rejection_reason?: string | null;
  created_at?: string;
  updated_at?: string;
  students?: any;
  subjects?: any;
  classes?: any;
}

export interface TeacherAssignment {
  id: string;
  teacher_user_id: string;
  class_id: string;
  subject_id: string;
  created_at?: string;
  classes?: ClassRecord;
  subjects?: SubjectRecord;
}

export interface TermRecord {
  id: string;
  name: string;
  session: string;
  is_active: boolean;
  can_teachers_edit: boolean;
  created_at?: string;
}

export interface AttendanceRecord {
  id: string;
  student_id: string;
  term: string;
  days_present: number;
  days_absent: number;
  created_at?: string;
  updated_at?: string;
}

export interface StudentEvaluation {
  id?: string;
  student_id: string;
  term: string;
  session: string;
  punctuality?: number | null;
  neatness?: number | null;
  politeness?: number | null;
  honesty?: number | null;
  cooperation?: number | null;
  leadership?: number | null;
  handwriting?: number | null;
  sports?: number | null;
  crafts?: number | null;
  music?: number | null;
  teacher_remark?: string | null;
  principal_remark?: string | null;
  submitted_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PublishedSnapshot {
  id: string;
  class_id: string;
  report_type: "PR1" | "PR2" | "PR3" | "TR";
  term: string;
  session: string;
  snapshot_data: any;
  published_by: string;
  published_at: string;
}
