import type { Factor } from "./types";

/** ปัจจัย 4 หมวด ใช้จัดกลุ่มปัญหาให้อ่านง่าย */
export const FACTORS: Record<Factor, { label: string; icon: string; desc: string }> = {
  teacher: { label: "ครู", icon: "👩‍🏫", desc: "สอนซ้อน ติดประชุม หรือยังไม่มีผู้สอน" },
  room: { label: "ห้อง", icon: "🏫", desc: "ห้องหรือสนามซ้อน ที่นั่งไม่พอ หรือผิดประเภท" },
  time: { label: "เวลา", icon: "⏰", desc: "ทับพักเที่ยง กิจกรรม หรือคาบว่างมาก" },
  special: { label: "เงื่อนไขพิเศษ", icon: "⭐", desc: "วิชาเลือก วิชาเลือกเสรี ชั่วโมงเรียน" },
};

/** ชนิดปัญหา → หมวด และวิธีแก้สั้นๆ */
const ISSUE: Record<string, { factor: Factor; fix: string }> = {
  teacher_overlap: { factor: "teacher", fix: "ลากวิชาหนึ่งไปช่องสีเขียว" },
  teacher_busy: { factor: "teacher", fix: "ย้ายออกจากเวลาประชุม/พบที่ปรึกษา" },
  no_teacher: { factor: "teacher", fix: "เพิ่มผู้สอนในหน้ากรอกข้อมูลเอง" },
  room_overlap: { factor: "room", fix: "เปลี่ยนห้องหรือย้ายเวลา" },
  no_room: { factor: "room", fix: "กำหนดห้องประจำของกลุ่ม" },
  not_homeroom: { factor: "room", fix: "เปลี่ยนเป็นห้องประจำ" },
  not_computer_room: { factor: "room", fix: "เลือกห้องคอมพิวเตอร์" },
  capacity: { factor: "room", fix: "ใช้ห้องที่จุได้มากกว่า" },
  no_field: { factor: "room", fix: "ใส่สถานที่ใช้ในข้อมูลรายวิชา" },
  field_sport: { factor: "room", fix: "เลือกสนามที่รองรับกีฬานี้" },
  free_elective_room: { factor: "room", fix: "ใช้ห้องประจำชั้นปี 1–4" },
  lunch: { factor: "time", fix: "ย้ายออกจากคาบพักเที่ยง" },
  out_of_range: { factor: "time", fix: "ย้ายให้อยู่ในคาบ 1–9" },
  group_overlap: { factor: "time", fix: "ลากวิชาหนึ่งไปช่องสีเขียว" },
  group_busy: { factor: "time", fix: "ย้ายออกจากช่วงกิจกรรม" },
  gap: { factor: "time", fix: "ย้ายวิชาให้ชิดกัน (ไม่บังคับ)" },
  relaxed: { factor: "time", fix: "ไม่บังคับแก้" },
  split_block: { factor: "time", fix: "ย้ายให้คาบต่อกัน" },
  hours_mismatch: { factor: "special", fix: "จัดตารางใหม่" },
  elective_not_aligned: { factor: "special", fix: "ย้ายให้อยู่เวลาเดียวกัน" },
  not_scheduled_course: { factor: "special", fix: "วิชานี้ไม่ต้องลงตาราง" },
};

export function issueInfo(type: string): { factor: Factor; fix: string } {
  return ISSUE[type] ?? { factor: "special", fix: "" };
}

export const FACTOR_STYLE: Record<Factor, string> = {
  teacher: "bg-brand-50 text-brand-700 border-brand-200",
  room: "bg-sky-50 text-sky-700 border-sky-200",
  time: "bg-amber-50 text-amber-700 border-amber-200",
  special: "bg-violet-50 text-violet-700 border-violet-200",
};
