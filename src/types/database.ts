export type UserRole = "admin" | "teacher" | "student";

export interface UserProfile {
  id: string;
  auth_id: string;
  email: string;
  display_name: string;
  role: UserRole;
  created_at?: string;
  updated_at?: string;
}

export interface ClassRecord {
  id: string;
  name: string;
  school_id?: string;
  arm?: string;
  created_at?: string;
}

export interface SubjectRecord {
  id: string;
  name: string;
  code?: string;
  school_id?: string;
  created_at?: string;
}

export interface StudentRecord {
  id: string;
  user_id?: string;
  admission_no: string;
  name: string;
  class_id?: string;
  classes?: {
    id?: string;
    name?: string;
  } | null;
  users?: {
    email?: string;
  } | null;
  gender?: string;
  date_of_birth?: string;
  guardian_name?: string;
  guardian_phone?: string;
  guardian_email?: string;
  portal_access_status?: "ACTIVE" | "LOCKED";
  portal_lock_reason?: string | null;
  created_at?: string;
}

export interface TeacherAssignmentRecord {
  id: string;
  teacher_user_id: string;
  class_id?: string;
  subject_id?: string;
  classes?: {
    id: string;
    name: string;
  } | null;
  subjects?: {
    id: string;
    name: string;
  } | null;
  created_at?: string;
}

export interface ResultRecord {
  id: string;
  student_id: string;
  subject_id: string;
  class_id?: string;
  term: string;
  session?: string;
  cw?: number;
  hw?: number;
  test?: number;
  project?: number;
  exam?: number;
  total?: number;
  grade?: string;
  remark?: string;
  score_breakdown?: any;
  status: "draft" | "submitted" | "approved" | "published" | "returned";
  return_reason?: string | null;
  submitted_at?: string | null;
  approved_at?: string | null;
  published_at?: string | null;
  students?: {
    id: string;
    name: string;
    admission_no: string;
    class_id?: string;
  } | null;
  subjects?: {
    id: string;
    name: string;
  } | null;
  pr1_status?: string | null;
  pr2_status?: string | null;
  pr3_status?: string | null;
  tr_status?: string | null;
}

export interface AppSettingsRecord {
  id?: string;
  school_name?: string;
  current_session: string;
  current_term: string;
  resumption_date?: string | null;
  updated_at?: string;
}

export interface TermRecord {
  id?: string;
  session: string;
  term: string;
  allow_teacher_edit?: boolean;
  status?: "open" | "closed" | string;
  created_at?: string;
}

export interface PublishedSnapshotRecord {
  id?: string;
  student_id: string;
  class_id?: string;
  term: string;
  session: string;
  report_type: "PR1" | "PR2" | "PR3" | "TR";
  snapshot_data: any;
  published_at?: string;
}

export interface FeeStructureRecord {
  id: string;
  title: string;
  class_id?: string;
  term: string;
  academic_session: string;
  amount: number;
  breakdown?: any;
  classes?: {
    name: string;
  } | null;
  created_at?: string;
}

export interface PaymentInvoiceRecord {
  id: string;
  student_id: string;
  fee_structure_id?: string;
  class_id?: string;
  academic_session: string;
  term: string;
  total_amount: number;
  amount_paid: number;
  status: "UNPAID" | "PARTIALLY PAID" | "FULLY PAID";
  invoice_number: string;
  created_at?: string;
}

export interface PaymentRecordItem {
  id: string;
  invoice_id: string;
  student_id?: string;
  payment_reference: string;
  receipt_number: string;
  amount: number;
  payment_gateway: string;
  status: string;
  payment_date: string;
  verified_at?: string;
}
