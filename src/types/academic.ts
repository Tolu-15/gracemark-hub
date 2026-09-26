export interface SectionRecord {
  id: string;
  class_id: string;
  name: string;
  created_at?: string;
}

export interface StudentEnrollment {
  id: string;
  student_id: string;
  academic_session_id: string;
  session: string;
  class_id: string;
  section_id?: string | null;
  status: "active" | "promoted" | "repeated" | "graduated" | "withdrawn";
  enrolled_at?: string;
  created_at?: string;
  classes?: { id: string; name: string } | null;
  sections?: { id: string; name: string } | null;
  students?: {
    id: string;
    admission_no: string;
    name: string;
    user_id: string;
    portal_access_status?: string;
  } | null;
}

export interface ClassTeacherAssignment {
  id: string;
  academic_session_id: string;
  session: string;
  class_id: string;
  section_id?: string | null;
  teacher_user_id: string;
  status: "active" | "ended";
  start_date: string;
  end_date?: string | null;
  notes?: string | null;
  created_at?: string;
  classes?: { id: string; name: string } | null;
  sections?: { id: string; name: string } | null;
  teacher?: {
    id: string;
    auth_id: string;
    display_name: string;
    email: string;
    staff_id?: string | null;
  } | null;
}

export interface SubjectTeacherAssignment {
  id: string;
  academic_session_id: string;
  session: string;
  class_id: string;
  section_id?: string | null;
  subject_id: string;
  teacher_user_id: string;
  status: "active" | "ended";
  start_date: string;
  end_date?: string | null;
  notes?: string | null;
  created_at?: string;
  classes?: { id: string; name: string } | null;
  sections?: { id: string; name: string } | null;
  subjects?: { id: string; name: string } | null;
  teacher?: {
    id: string;
    auth_id: string;
    display_name: string;
    email: string;
    staff_id?: string | null;
  } | null;
}

export interface StaffProfile {
  id: string;
  auth_id: string;
  staff_id?: string | null;
  email: string;
  personal_email?: string | null;
  phone?: string | null;
  display_name: string;
  role: "admin" | "teacher" | "student";
  status: "active" | "former" | "suspended";
  must_change_password?: boolean;
  created_at?: string;
}

export type SubjectEnrollmentStatus = "enrolled" | "dropped" | "exempted";

export interface StudentSubjectEnrollment {
  id: string;
  student_id: string;
  subject_id: string;
  academic_session_id?: string | null;
  session: string;
  class_id?: string | null;
  enrollment_id?: string | null;
  status: SubjectEnrollmentStatus;
  is_active: boolean;
  dropped_at?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  subjects?: { id: string; name: string } | null;
  students?: { id: string; name: string; admission_no: string } | null;
  classes?: { id: string; name: string } | null;
}
