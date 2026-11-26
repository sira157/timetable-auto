import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import CrudPage, { type FieldDef } from "../components/CrudPage";
import UnavailablePicker from "../components/UnavailablePicker";
import { Alert, Badge, EmptyState, PageHeader, Spinner, useApi, useToast } from "../components/ui";
import { api } from "../lib/api";
import type { Busy, Course, Group, Room, Section, Settings, Teacher } from "../lib/types";

const ROOM_KIND_LABEL: Record<string, string> = { classroom: "ห้องเรียน", computer: "ห้องคอมพิวเตอร์", meeting: "ห้องประชุม", field: "สนาม/โรงยิม" };
const BUSY_KIND_LABEL: Record<string, string> = { meeting: "ประชุม", activity: "กิจกรรม", unavailable: "ไม่ว่าง" };

function Codes({ codes, names }: { codes: string[]; names?: Map<string, string> }) {
  if (!codes.length) return <span className="text-slate-400">-</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {codes.map((c) => (
        <span key={c} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700" title={names?.get(c) ?? c}>
          {names?.get(c) ?? c}
        </span>
      ))}
    </span>
  );
}

export function TeachersPage() {
  const fields: FieldDef[] = [
    { key: "code", label: "รหัสอาจารย์", type: "text", required: true },
    { key: "name", label: "ชื่อ-สกุล", type: "text", required: true },
    { key: "note", label: "หมายเหตุ", type: "textarea" },
    { key: "is_admin", label: "ฝ่ายบริหาร (ประชุมวันอังคารคาบ 1–4 ไม่จัดสอน)", type: "bool", full: true },
    { key: "is_excluded", label: "ไม่ลงทะเบียน (ไม่ใช้จัดตาราง)", type: "bool", full: true },
  ];
  return (
    <CrudPage<Teacher>
      entity="teachers"
      title="อาจารย์"
      subtitle="รายชื่อผู้สอน ใช้รหัสอาจารย์อ้างอิงในการเปิดสอนและเวลาที่ไม่ว่าง"
      fields={fields}
      defaults={{ is_excluded: false, is_admin: false }}
      searchText={(t) => `${t.code} ${t.name} ${t.is_admin ? "ฝ่ายบริหาร" : ""}`}
      deleteLabel={(t) => `${t.code} ${t.name}`}
      columns={[
        { key: "code", label: "รหัส", className: "font-medium whitespace-nowrap" },
        { key: "name", label: "ชื่อ-สกุล" },
        {
          key: "status",
          label: "สถานะ",
          render: (t) => (
            <span className="flex flex-wrap gap-1">
              {t.is_excluded ? <Badge tone="muted" strike>ไม่ลงทะเบียน</Badge> : <Badge tone="ok">ใช้งาน</Badge>}
              {t.is_admin && <Badge tone="purple">ฝ่ายบริหาร</Badge>}
            </span>
          ),
        },
        { key: "note", label: "หมายเหตุ", className: "text-slate-500" },
      ]}
    />
  );
}

export function CoursesPage() {
  const fields: FieldDef[] = [
    { key: "code", label: "รหัสวิชา", type: "text", required: true },
    { key: "name", label: "ชื่อวิชา", type: "text", required: true },
    { key: "credits", label: "หน่วยกิต น(ท-ป-ศ)", type: "text", required: true, placeholder: "3(2-2-5)", hint: "ชั่วโมงเรียน = ทฤษฎี + ปฏิบัติ" },
    { key: "category", label: "หมวดวิชา", type: "text", placeholder: "เช่น ภาษา, ทักษะและการสอนกีฬา" },
    { key: "elective_set", label: "กลุ่มวิชาเลือก", type: "text", hint: "วิชาในกลุ่มเดียวกันจะจัดเวลาเดียวกัน" },
    { key: "sport", label: "กีฬา", type: "text", hint: "เว้นว่างได้ ระบบจะหาจากชื่อวิชา" },
    { key: "hours", label: "ชั่วโมง/สัปดาห์", type: "number", hint: "ใช้เมื่อหน่วยกิตไม่ใช่ น(ท-ป-ศ) เช่น 1(90) เรียน 4 ชม." },
    { key: "venue", label: "สถานที่ใช้", type: "text", full: true, hint: "ชื่อสนามหรือจุด หลายจุดคั่นด้วยจุลภาค เช่น สนามฟุตบอล จุดที่ 1" },
    { key: "combined", label: "เรียนรวม (ทุกกลุ่มในชั้นปีเรียนพร้อมกัน)", type: "bool" },
    { key: "free_elective", label: "วิชาเลือกเสรี", type: "bool" },
    { key: "is_excluded", label: "ไม่ลงทะเบียน (ไม่ใช้จัดตาราง)", type: "bool", full: true },
  ];
  return (
    <CrudPage<Course>
      entity="courses"
      title="รายวิชา"
      subtitle="หน่วยกิตเขียนในรูปแบบ น(ท-ป-ศ) เช่น 3(2-2-5)"
      fields={fields}
      defaults={{ combined: false, free_elective: false, is_excluded: false, hours: 0 }}
      searchText={(c) => `${c.code} ${c.name} ${c.category} ${c.elective_set}`}
      deleteLabel={(c) => `${c.code} ${c.name}`}
      columns={[
        { key: "code", label: "รหัสวิชา", className: "font-medium whitespace-nowrap" },
        { key: "name", label: "ชื่อวิชา" },
        {
          key: "credits",
          label: "หน่วยกิต",
          className: "whitespace-nowrap tabular-nums",
          render: (c) => (
            <span>
              {c.credits}
              {c.hours > 0 && <span className="block text-xs text-slate-500">เรียน {c.hours} ชม./สัปดาห์</span>}
            </span>
          ),
        },
        { key: "category", label: "หมวด", className: "text-slate-600" },
        {
          key: "flags",
          label: "ประเภท",
          render: (c) => (
            <span className="flex flex-wrap gap-1">
              {c.combined && <Badge tone="ok">เรียนรวม</Badge>}
              {c.elective_set && <Badge tone="info">วิชาเลือก: {c.elective_set}</Badge>}
              {c.free_elective && <Badge tone="purple">เลือกเสรี</Badge>}
              {c.is_excluded && <Badge tone="muted" strike>ไม่ลงทะเบียน</Badge>}
            </span>
          ),
        },
        { key: "venue", label: "สถานที่ใช้", className: "text-slate-600" },
      ]}
    />
  );
}

export function GroupsPage() {
  const fields: FieldDef[] = [
    { key: "code", label: "รหัสกลุ่ม", type: "text", required: true, placeholder: "1/1" },
    { key: "name", label: "ชื่อกลุ่ม", type: "text", required: true, placeholder: "ปี 1/1" },
    { key: "year", label: "ชั้นปี", type: "number", required: true },
    { key: "size", label: "จำนวนนักศึกษา", type: "number" },
    { key: "homeroom", label: "ห้องประจำ", type: "text", placeholder: "321" },
    { key: "advisor", label: "อาจารย์ที่ปรึกษา (รหัส)", type: "text" },
    { key: "is_excluded", label: "ไม่ลงทะเบียน (ไม่ใช้จัดตาราง)", type: "bool", full: true },
  ];
  return (
    <CrudPage<Group>
      entity="groups"
      title="กลุ่มเรียน"
      subtitle="ในการเปิดสอน พิมพ์ “ปี 1” แทนทุกกลุ่มของชั้นปีที่ 1 ได้"
      fields={fields}
      defaults={{ year: 1, size: 20, is_excluded: false }}
      searchText={(g) => `${g.code} ${g.name} ${g.homeroom}`}
      deleteLabel={(g) => g.name}
      columns={[
        { key: "code", label: "รหัส", className: "font-medium" },
        { key: "name", label: "ชื่อกลุ่ม" },
        { key: "year", label: "ชั้นปี", className: "tabular-nums" },
        { key: "size", label: "จำนวน", className: "tabular-nums", render: (g) => `${g.size} คน` },
        { key: "homeroom", label: "ห้องประจำ", render: (g) => g.homeroom || <Badge tone="warn">ยังไม่มี</Badge> },
        { key: "advisor", label: "ที่ปรึกษา" },
        { key: "status", label: "สถานะ", render: (g) => (g.is_excluded ? <Badge tone="muted" strike>ไม่ลงทะเบียน</Badge> : <Badge tone="ok">ใช้งาน</Badge>) },
      ]}
    />
  );
}

export function RoomsPage() {
  const fields: FieldDef[] = [
    { key: "name", label: "ชื่อห้อง/จุด", type: "text", required: true, placeholder: "321 หรือ สนามฟุตบอล จุดที่ 1" },
    { key: "building", label: "อาคาร/สนาม", type: "text" },
    {
      key: "kind",
      label: "ประเภท",
      type: "select",
      options: Object.entries(ROOM_KIND_LABEL).map(([value, label]) => ({ value, label })),
    },
    { key: "capacity", label: "ความจุ (คน)", type: "number" },
    { key: "sports", label: "กีฬาที่รองรับ (สำหรับสนาม)", type: "list", full: true, hint: "คั่นด้วยจุลภาค เช่น ฟุตบอล, กรีฑา" },
  ];
  return (
    <CrudPage<Room>
      entity="rooms"
      title="ห้องเรียน"
      subtitle="ห้องเรียน ห้องคอมพิวเตอร์ ห้องประชุม และจุดของโรงยิม/สนามกีฬา"
      fields={fields}
      defaults={{ kind: "classroom", capacity: 40, sports: [] }}
      searchText={(r) => `${r.name} ${r.building} ${r.sports.join(" ")}`}
      deleteLabel={(r) => r.name}
      columns={[
        { key: "name", label: "ชื่อ", className: "font-medium" },
        { key: "building", label: "อาคาร/สนาม" },
        {
          key: "kind",
          label: "ประเภท",
          render: (r) => (
            <Badge tone={r.kind === "field" ? "ok" : r.kind === "meeting" ? "purple" : r.kind === "computer" ? "warn" : "info"}>
              {ROOM_KIND_LABEL[r.kind] ?? r.kind}
            </Badge>
          ),
        },
        { key: "capacity", label: "ความจุ", className: "tabular-nums", render: (r) => `${r.capacity} คน` },
        { key: "sports", label: "กีฬาที่รองรับ", render: (r) => <Codes codes={r.sports} /> },
      ]}
    />
  );
}

export function BuildingsPage() {
  const { data, loading, error } = useApi<Room[]>("/api/data/rooms");
  const buildings = useMemo(() => {
    const m = new Map<string, Room[]>();
    for (const r of data ?? []) {
      const b = r.building || "ไม่ระบุอาคาร";
      m.set(b, [...(m.get(b) ?? []), r]);
    }
    return [...m.entries()];
  }, [data]);
  return (
    <div>
      <PageHeader title="อาคาร" subtitle="สรุปห้องและจุดสนามแยกตามอาคาร แก้ไขข้อมูลได้ที่เมนูห้องเรียน" />
      {loading && <Spinner />}
      {error && <Alert tone="error">{error}</Alert>}
      {!loading && buildings.length === 0 && <EmptyState title="ยังไม่มีข้อมูลห้องเรียน" />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {buildings.map(([b, rooms]) => (
          <div key={b} className="card">
            <div className="mb-3 flex items-start justify-between gap-2">
              <h2 className="font-bold text-slate-800">{b}</h2>
              <span className="text-xs text-slate-500 tabular-nums">{rooms.length} ห้อง/จุด</span>
            </div>
            <ul className="space-y-1.5 text-sm">
              {rooms.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-slate-700">{r.name}</span>
                  <span className="shrink-0 text-xs text-slate-500">{r.kind === "field" ? r.sports.join(", ") || "สนาม" : `${r.capacity} คน`}</span>
                </li>
              ))}
            </ul>
            <Link to={`/timetable?view=building&id=${encodeURIComponent(b)}`} className="mt-4 inline-flex text-sm font-medium text-brand-600 hover:text-brand-700">
              ดูตารางการใช้อาคาร →
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

function useLookups() {
  const courses = useApi<Course[]>("/api/data/courses");
  const teachers = useApi<Teacher[]>("/api/data/teachers");
  const groups = useApi<Group[]>("/api/data/groups");
  return useMemo(() => {
    const courseMap = new Map((courses.data ?? []).map((c) => [c.code, c]));
    const teacherNames = new Map((teachers.data ?? []).map((t) => [t.code, t.name]));
    const groupNames = new Map((groups.data ?? []).map((g) => [g.code, g.name]));
    return { courseMap, teacherNames, groupNames, courses: courses.data ?? [], ready: Boolean(courses.data && teachers.data && groups.data) };
  }, [courses.data, teachers.data, groups.data]);
}

function SectionsPage({ title, subtitle, filter, intro }: { title: string; subtitle: string; filter?: (s: Section, courses: Map<string, Course>) => boolean; intro?: ReactNode }) {
  const lk = useLookups();
  const fields: FieldDef[] = [
    {
      key: "course_code",
      label: "รายวิชา",
      type: "select",
      required: true,
      full: true,
      options: [{ value: "", label: "— เลือกรายวิชา —" }, ...lk.courses.map((c) => ({ value: c.code, label: `${c.code} ${c.name} ${c.credits}` }))],
    },
    { key: "group_codes", label: "กลุ่มเรียน", type: "list", required: true, full: true, hint: "รหัสกลุ่มคั่นด้วยจุลภาค เช่น 1/1, 1/2 หรือ “ปี 1” = ทุกกลุ่มของชั้นปี" },
    { key: "teacher_codes", label: "ผู้สอน (รหัส)", type: "list", full: true, hint: "มากกว่า 1 คน = สอนร่วม ผู้สอนทุกคนต้องว่างพร้อมกัน" },
    { key: "places", label: "สถานที่ที่ใช้ (ไม่บังคับ)", type: "list", full: true, hint: "ชื่อห้อง/สนามตามเมนูห้องเรียน คั่นด้วยจุลภาค ถ้าระบุ ระบบจะใช้ตามนี้" },
    { key: "note", label: "หมายเหตุ", type: "textarea" },
  ];
  if (!lk.ready) return <Spinner />;
  return (
    <CrudPage<Section>
      entity="sections"
      title={title}
      subtitle={subtitle}
      intro={intro}
      fields={fields}
      defaults={{ course_code: "", group_codes: [], teacher_codes: [], places: [] }}
      filter={filter ? (s) => filter(s, lk.courseMap) : undefined}
      addLabel="เพิ่มการเปิดสอน"
      searchText={(s) => `${s.course_code} ${lk.courseMap.get(s.course_code)?.name ?? ""} ${s.group_codes.join(" ")} ${s.teacher_codes.map((t) => lk.teacherNames.get(t) ?? t).join(" ")}`}
      deleteLabel={(s) => `${s.course_code} (${s.group_codes.join(", ")})`}
      columns={[
        {
          key: "course",
          label: "รายวิชา",
          render: (s) => {
            const c = lk.courseMap.get(s.course_code);
            return (
              <div>
                <div className="font-medium whitespace-nowrap">{s.course_code}</div>
                <div className="text-xs text-slate-500">{c ? `${c.name} · ${c.credits}` : <span className="text-violet-700">ไม่พบในทะเบียนรายวิชา</span>}</div>
              </div>
            );
          },
        },
        { key: "groups", label: "กลุ่มเรียน", render: (s) => <Codes codes={s.group_codes} names={lk.groupNames} /> },
        { key: "places", label: "สถานที่", render: (s) => <Codes codes={s.places ?? []} /> },
        {
          key: "teachers",
          label: "ผู้สอน",
          render: (s) => (s.teacher_codes.length ? <Codes codes={s.teacher_codes} names={lk.teacherNames} /> : <Badge tone="warn">ยังไม่มีผู้สอน</Badge>),
        },
        {
          key: "kind",
          label: "ประเภท",
          render: (s) => {
            const c = lk.courseMap.get(s.course_code);
            return (
              <span className="flex flex-wrap gap-1">
                {c?.combined && <Badge tone="ok">เรียนรวม</Badge>}
                {s.teacher_codes.length > 1 && <Badge tone="info">สอนร่วม</Badge>}
                {c?.elective_set && <Badge tone="info">วิชาเลือก</Badge>}
                {c?.free_elective && <Badge tone="purple">เลือกเสรี</Badge>}
              </span>
            );
          },
        },
      ]}
    />
  );
}

export function CombinedPage() {
  return <SectionsPage title="เรียนรวม" subtitle="วิชาที่ทุกกลุ่มในชั้นปีเดียวกันเรียนพร้อมกัน ใช้ห้องประชุม 1 และ 2 ก่อน" filter={(s, cm) => Boolean(cm.get(s.course_code)?.combined)} />;
}

export function CoTeachPage() {
  return <SectionsPage title="สอนร่วม" subtitle="วิชาที่มีผู้สอนมากกว่า 1 คน ผู้สอนทุกคนต้องว่างพร้อมกันและนับเป็นภาระงานของทุกคน" filter={(s) => s.teacher_codes.length > 1} />;
}

export function BusyPage() {
  const settings = useApi<{ settings: Settings }>("/api/settings");
  const busyList = useApi<Busy[]>("/api/data/busy");
  const teachers = useApi<Teacher[]>("/api/data/teachers");
  const toast = useToast();
  const [rev, setRev] = useState(0); // เปลี่ยนค่าเพื่อโหลดรายการด้านล่างใหม่หลังบันทึก
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const teacherNames = useMemo(() => new Map((teachers.data ?? []).map((t) => [t.code, t.name])), [teachers.data]);
  if (!settings.data) return settings.error ? <Alert tone="error">{settings.error}</Alert> : <Spinner />;
  const days = settings.data.settings.days;
  const periods = settings.data.settings.periods;
  const periodOptions = periods.map((p) => ({ value: p.no, label: `คาบ ${p.no} (${p.start}–${p.end})` }));
  const fields: FieldDef[] = [
    { key: "kind", label: "ประเภท", type: "select", options: Object.entries(BUSY_KIND_LABEL).map(([value, label]) => ({ value, label })) },
    { key: "name", label: "ชื่อรายการ", type: "text", required: true, placeholder: "เช่น ประชุมผู้บริหาร" },
    { key: "day", label: "วัน", type: "select", options: days.map((d, i) => ({ value: i, label: d })) },
    { key: "start", label: "ตั้งแต่", type: "select", options: periodOptions },
    { key: "end", label: "ถึง", type: "select", options: periodOptions },
    { key: "teacher_codes", label: "ผู้สอนที่เกี่ยวข้อง (รหัส)", type: "list", full: true, hint: "คั่นด้วยจุลภาค" },
    { key: "group_codes", label: "กลุ่มเรียนที่เกี่ยวข้อง", type: "list", full: true, hint: "รหัสกลุ่ม หรือ “ปี 1”" },
  ];
  return (
    <CrudPage<Busy>
      key={rev}
      entity="busy"
      title="เวลาที่ไม่ว่าง"
      subtitle="ประชุม กิจกรรม และเวลาที่ผู้สอนไม่ว่าง ระบบจะไม่จัดสอนในช่วงเวลาเหล่านี้"
      intro={
        <>
          <UnavailablePicker
            settings={settings.data.settings}
            busy={busyList.data ?? []}
            teacherId={teacherId}
            onTeacher={setTeacherId}
            onSaved={(msg) => {
              toast.ok(msg);
              busyList.reload();
              setRev((r) => r + 1);
            }}
            onError={(m) => toast.error(m)}
          />
          {toast.node}
        </>
      }
      fields={fields}
      defaults={{ kind: "meeting", day: 0, start: 1, end: 2, teacher_codes: [], group_codes: [] }}
      searchText={(b) => `${b.name} ${b.teacher_codes.map((t) => teacherNames.get(t) ?? t).join(" ")} ${b.group_codes.join(" ")}`}
      deleteLabel={(b) => b.name}
      columns={[
        { key: "kind", label: "ประเภท", render: (b) => <Badge tone={b.kind === "activity" ? "purple" : b.kind === "meeting" ? "muted" : "warn"}>{BUSY_KIND_LABEL[b.kind]}</Badge> },
        { key: "name", label: "ชื่อรายการ", className: "font-medium" },
        { key: "when", label: "เวลา", className: "whitespace-nowrap", render: (b) => `วัน${days[b.day] ?? "?"} คาบ ${b.start}–${b.end}` },
        { key: "teachers", label: "ผู้สอน", render: (b) => <Codes codes={b.teacher_codes} names={teacherNames} /> },
        { key: "groups", label: "กลุ่มเรียน", render: (b) => <Codes codes={b.group_codes} /> },
      ]}
    />
  );
}

export function UnregisteredPage() {
  const teachers = useApi<Teacher[]>("/api/data/teachers");
  const groups = useApi<Group[]>("/api/data/groups");
  const courses = useApi<Course[]>("/api/data/courses");
  const settings = useApi<{ settings: Settings }>("/api/settings");
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const internships = useMemo(() => {
    const s = settings.data?.settings;
    if (!s) return [];
    const codes = new Set(s.internship_codes.map((c) => c.replace(/\s+/g, "").toLowerCase()));
    return (courses.data ?? []).filter(
      (c) => codes.has(c.code.replace(/\s+/g, "").toLowerCase()) || s.internship_keywords.some((k) => k && c.name.includes(k)),
    );
  }, [courses.data, settings.data]);

  async function restore(entity: string, row: Teacher | Group | Course) {
    setBusy(true);
    try {
      await api.put(`/api/data/${entity}/${row.id}`, { ...row, is_excluded: false });
      toast.ok("นำกลับมาใช้แล้ว");
      teachers.reload();
      groups.reload();
      courses.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sections: { entity: string; title: string; rows: (Teacher | Group | Course)[] }[] = [
    { entity: "teachers", title: "อาจารย์", rows: (teachers.data ?? []).filter((x) => x.is_excluded) },
    { entity: "groups", title: "กลุ่มเรียน", rows: (groups.data ?? []).filter((x) => x.is_excluded) },
    { entity: "courses", title: "รายวิชา", rows: (courses.data ?? []).filter((x) => x.is_excluded) },
  ];
  const loading = teachers.loading || groups.loading || courses.loading;

  return (
    <div>
      <PageHeader title="ข้อมูลไม่ลงทะเบียน" subtitle="รายการที่ไม่นำมาจัดตาราง และวิชาฝึกประสบการณ์วิชาชีพที่ไม่ต้องจัดลงตาราง" />
      {loading && <Spinner />}
      <div className="space-y-4">
        <div className="card">
          <h2 className="mb-1 font-bold">วิชาที่ไม่ต้องจัดลงตาราง (ฝึกงาน/ฝึกประสบการณ์วิชาชีพ)</h2>
          <p className="mb-3 text-sm text-slate-500">ตารางของชั้นปีนั้นจะแสดงหัวว่า “ปฏิบัติสอนในสถานศึกษา” พร้อมชื่ออาจารย์ที่ปรึกษา</p>
          {internships.length === 0 ? (
            <p className="text-sm text-slate-400">ไม่มี</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {internships.map((c) => (
                <li key={c.id}>
                  <Badge tone="purple">
                    {c.code} {c.name}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
        {sections.map((s) => (
          <div key={s.entity} className="card">
            <h2 className="mb-3 font-bold">
              {s.title} <span className="text-sm font-normal text-slate-500 tabular-nums">({s.rows.length})</span>
            </h2>
            {s.rows.length === 0 ? (
              <p className="text-sm text-slate-400">ไม่มีรายการที่ไม่ลงทะเบียน</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {s.rows.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0">
                      <Badge tone="muted" strike>
                        {r.code}
                      </Badge>{" "}
                      <span className="text-slate-700">{r.name}</span>
                    </span>
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => restore(s.entity, r)}>
                      นำกลับมาใช้
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {toast.node}
    </div>
  );
}
