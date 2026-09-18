export type UserRole = "admin" | "teacher" | "student";

export interface UserProfile {
  id: string;
  auth_id: string;
  email: string | null;
  display_name: string | null;
  role: UserRole;
  created_at: string;
}

export interface School {
  id: string;
  name: string;
  session: string;
  created_at: string;
}

export interface SchoolClass {
  id: string;
  name: string;
  session: string;
  school_id: string;
  created_at: string;
}

export interface Subject {
  id: string;
  name: string;
  created_at: string;
}

export interface Student {
  id: string;
  class_id: string;
  user_id: string;
  admission_no: string;
  name: string;
  gender?: string | null;
  dob?: string | null;
  guardian_name?: string | null;
  guardian_phone?: string | null;
  portal_access_status?: "ACTIVE" | "LOCKED" | null;
  created_at: string;
  users?: {
    email: string;
    display_name?: string;
  };
  classes?: {
    id: string;
    name: string;
  };
}

export interface TeacherAssignment {
  id: string;
  teacher_user_id: string;
  class_id: string;
  subject_id: string;
  created_at: string;
  classes?: SchoolClass;
  subjects?: Subject;
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
  created_at: string;
  updated_at: string;
}

export interface StudentEvaluation {
  id: string;
  student_id: string;
  term: string;
  session?: string;
  punctuality?: number;
  neatness?: number;
  politeness?: number;
  honesty?: number;
  cooperation?: number;
  leadership?: number;
  attentiveness?: number;
  perseverance?: number;
  sports?: number;
  handwriting?: number;
  teacher_remarks?: string;
  principal_remarks?: string;
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
