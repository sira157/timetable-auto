export type Role = "staff" | "teacher" | "student";

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  role_label: string;
  scope_id: number | null;
  must_change_password: boolean;
  is_active: boolean;
  last_login_at: string | null;
}

export interface Teacher {
  id: number;
  code: string;
  name: string;
  is_admin: boolean;
  is_excluded: boolean;
  note: string;
}

export interface Group {
  id: number;
  code: string;
  name: string;
  year: number;
  size: number;
  homeroom: string;
  is_excluded: boolean;
}

export type RoomKind = "classroom" | "computer" | "meeting" | "field";

export interface Room {
  id: number;
  name: string;
  building: string;
  kind: RoomKind;
  capacity: number;
  sports: string[];
}

export interface Course {
  id: number;
  code: string;
  name: string;
  credits: string;
  category: string;
  combined: boolean;
  elective_set: string;
  free_elective: boolean;
  venue: string;
  sport: string;
  hours: number;
  is_excluded: boolean;
}

export interface Section {
  id: number;
  course_code: string;
  group_codes: string[];
  teacher_codes: string[];
  places: string[];
  note: string;
}

export type BusyKind = "meeting" | "activity" | "unavailable";

export interface Busy {
  id: number;
  kind: BusyKind;
  name: string;
  day: number;
  start: number;
  end: number;
  teacher_codes: string[];
  group_codes: string[];
}

export interface Period {
  no: number;
  start: string;
  end: string;
}

export interface FixedBlock {
  name: string;
  kind?: "advisor" | "activity";
  day: number;
  start: number;
  end: number;
}

export interface Settings {
  days: string[];
  periods: Period[];
  lunch_periods: number[];
  common_blocks: FixedBlock[];
  admin_meeting: FixedBlock | null;
  max_block: number;
  max_gap: number;
  combined_rooms: string[];
  homeroom_categories: string[];
  field_categories: string[];
  computer_categories: string[];
  solver: "cpsat" | "greedy";
  internship_codes: string[];
  internship_keywords: string[];
  avoid_last_period: boolean;
  time_budget_sec: number;
}

export interface Issue {
  level: "error" | "warning";
  type: string;
  message: string;
  assignment_id?: number;
}

export interface Unplaced {
  section_id?: number;
  course_code: string;
  course_name?: string;
  hours: number;
  part?: string;
  group_codes: string[];
  teacher_codes: string[];
  reason: string;
  factor?: Factor;
}

export interface VersionSummary {
  id: number;
  name: string;
  created_at: string | null;
  created_by: string;
  is_active: boolean;
  relaxed_gap: boolean;
  stats: {
    total_hours: number;
    placed_hours: number;
    duration_ms: number;
    iterations: number;
    method?: "cpsat" | "greedy";
    solver_status?: string;
    gap_violations?: number;
    locks_kept: number;
    locks_dropped: number;
    teacher_overload: { teacher_code: string; teacher_name: string; hours: number; capacity: number }[];
  };
  errors: number;
  warnings: number;
  unplaced: number;
  data_changed: boolean;
}

export interface VersionDetail extends Omit<VersionSummary, "unplaced"> {
  issues: Issue[];
  unplaced: Unplaced[];
  notices: { type: string; course_code: string; course_name: string; group_codes: string[]; text: string }[];
}

export interface Summary {
  counts: { teachers: number; courses: number; groups: number; rooms: number; fields: number; sections: number; busy: number };
  readiness: Partial<Record<"ready" | "review" | "error" | "missing" | "skip", number>>;
  data_errors: number;
  settings_problems: string[];
  active: VersionSummary | null;
  versions: number;
}

export type EntryKind = "normal" | "combined" | "coteach" | "elective" | "free";

export interface Entry {
  id: number;
  section_id: number;
  block_index: number;
  unit_key: string;
  part: "all" | "both" | "theory" | "practice";
  kind: EntryKind;
  day: number;
  start: number;
  length: number;
  room: string | null;
  field: string | null;
  locked: boolean;
  course_code: string;
  course_name: string;
  teacher_codes: string[];
  group_codes: string[];
  teachers: string[];
  co_teachers: string[];
  credits: string;
  group_label: string;
  elective_set: string;
  groups: string[];
  coteach: boolean;
  /** ช่วงที่รวมไว้ในบล็อกเดียว (ทฤษฎี+ปฏิบัติห้องเดียวกันที่เรียนต่อกัน) */
  parts?: Entry[];
}

export interface TimetableEvent {
  kind: "meeting" | "activity";
  name: string;
  day: number;
  start: number;
  length: number;
}

export type View = "teacher" | "group" | "room" | "building";

export interface Timetable {
  version: { id: number; name: string; created_at: string | null };
  view: View;
  id: string;
  title: string;
  subtitle: string;
  days: string[];
  periods: Period[];
  lunch_periods: number[];
  entries: Entry[];
  events: TimetableEvent[];
  notices: { text: string; course: string; teachers?: string[] }[];
  total_hours: number;
}

export interface CheckResult {
  sections: { section_id: number; status: "ready" | "review" | "error" | "missing" | "skip"; messages: string[]; section: Section }[];
  general: { level: "error" | "warning"; message: string }[];
  counts: Record<string, number>;
}

export type Factor = "teacher" | "room" | "time" | "special";

export interface Job {
  id: string;
  status: "running" | "done" | "failed" | "cancelled";
  phase: string;
  phase_label: string;
  percent: number;
  elapsed_sec: number;
  budget_sec: number | null;
  placed_hours: number | null;
  total_hours: number | null;
  message: string;
  version_id: number | null;
  options: { name?: string; keep_locks?: boolean };
}

export interface MoveSlot {
  day: number;
  start: number;
  ok: boolean;
  reason: string;
  current: boolean;
}

export interface Moves {
  length: number;
  slots: MoveSlot[];
  linked: boolean;
}

export interface SampleInfo {
  size: "small" | "medium" | "large";
  label: string;
  teachers: number;
  groups: number;
  courses: number;
  sections: number;
  rooms: number;
}

/** ข้อมูลหลักสูตร (รูปแบบเดียวกับไฟล์ Excel ที่ใช้นำเข้า) ใช้ในหน้ากรอกข้อมูล */
export interface CurriculumRow {
  no: number | null;
  code: string;
  name: string;
  teachers: string;
  places: string;
  credits: string | null;
  category: string | null;
}

export interface CurriculumGroup {
  code: string;
  size: number;
  rows: CurriculumRow[];
}

export interface Curriculum {
  years: { year: number; groups: CurriculumGroup[] }[];
  admins: string[];
  lecture: { name: string; note: string }[];
  practice: { place: string; note: string }[];
}
