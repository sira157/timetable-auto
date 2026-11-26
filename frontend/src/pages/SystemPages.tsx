import { useEffect, useMemo, useRef, useState } from "react";
import { MIN_PASSWORD_LENGTH, useAuth } from "../auth/AuthContext";
import { IconArrowDown, IconPlus, IconTrash, IconUpload } from "../components/Icons";
import Modal from "../components/Modal";
import { Alert, Badge, EmptyState, Field, PageHeader, Spinner, formatDateTime, useApi, useToast } from "../components/ui";
import { api, csvBlob, downloadFile, saveBlob } from "../lib/api";
import type { Course, Role, Room, Settings, User } from "../lib/types";

// ---------------- ตั้งค่าเงื่อนไข ----------------

interface Option {
  value: string;
  label: string;
  hint?: string;
}

/** เลือกค่าหลายรายการจากข้อมูลจริงในระบบ ค่าที่ไม่พบในข้อมูลแสดงเป็นป้ายสีเหลืองให้เห็นชัด */
function ChipSelect({ label, hint, values, options, onChange, addLabel = "+ เพิ่ม" }: {
  label: string;
  hint?: string;
  values: string[];
  options: Option[];
  onChange: (v: string[]) => void;
  addLabel?: string;
}) {
  const known = new Map(options.map((o) => [o.value, o]));
  const rest = options.filter((o) => !values.includes(o.value));
  const missing = values.filter((v) => !known.has(v));
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-slate-300 bg-white p-1.5">
        {values.map((v) => {
          const o = known.get(v);
          return (
            <span
              key={v}
              title={o ? o.hint ?? o.label : "ไม่พบในข้อมูลปัจจุบัน"}
              className={`inline-flex max-w-full items-center gap-1 rounded-lg border px-2 py-1 text-sm ${
                o ? "border-brand-200 bg-brand-50 text-brand-800" : "border-amber-300 bg-amber-50 text-amber-800"
              }`}
            >
              <span className="truncate">{o?.label ?? v}</span>
              {o?.hint && <span className="shrink-0 text-xs opacity-70">{o.hint}</span>}
              <button
                type="button"
                className="-mr-1 inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-current opacity-60 hover:bg-white hover:opacity-100"
                aria-label={`นำ ${v} ออก`}
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                ×
              </button>
            </span>
          );
        })}
        {rest.length > 0 && (
          <select
            className="min-h-8 w-24 min-w-0 flex-1 cursor-pointer rounded-lg border-0 bg-transparent px-1 text-sm text-brand-700 outline-none"
            value=""
            aria-label={`${addLabel} ${label}`}
            onChange={(e) => e.target.value && onChange([...values, e.target.value])}
          >
            <option value="">{addLabel}</option>
            {rest.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
                {o.hint ? ` (${o.hint})` : ""}
              </option>
            ))}
          </select>
        )}
        {!values.length && !rest.length && <span className="px-1 text-sm text-slate-400">ยังไม่มีข้อมูลให้เลือก</span>}
      </div>
      {missing.length > 0 ? (
        <span className="mt-1 block text-xs text-amber-700">ไม่พบในข้อมูลปัจจุบัน: {missing.join(", ")} (ไม่มีผลกับการจัดตาราง)</span>
      ) : (
        hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>
      )}
    </div>
  );
}

/** เลือกคาบจากรายการคาบที่ตั้งไว้ */
function PeriodSelect({ value, periods, onChange, label }: { value: number; periods: Settings["periods"]; onChange: (n: number) => void; label: string }) {
  return (
    <select className="input" value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))}>
      {!periods.some((p) => p.no === value) && <option value={value}>คาบ {value} (ไม่มีแล้ว)</option>}
      {periods.map((p) => (
        <option key={p.no} value={p.no}>
          คาบ {p.no} ({p.start}–{p.end})
        </option>
      ))}
    </select>
  );
}

const listText = (xs: (string | number)[]) => xs.join(", ");
const parseList = (s: string) =>
  s
    .split(/[,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

export function SettingsPage() {
  const { data, loading, error, reload } = useApi<{ settings: Settings; problems: string[]; defaults: Settings }>("/api/settings");
  const courses = useApi<Course[]>("/api/data/courses");
  const rooms = useApi<Room[]>("/api/data/rooms");
  const teachers = useApi<{ is_admin: boolean; is_excluded: boolean }[]>("/api/data/teachers");
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const toast = useToast();

  useEffect(() => {
    if (data) setS(structuredClone(data.settings));
  }, [data]);

  if (loading && !s) return <Spinner />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!s) return null;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((o) => (o ? { ...o, [k]: v } : o));

  // ---- ตัวเลือกจากข้อมูลจริง ----
  const courseList = (courses.data ?? []).filter((c) => !c.is_excluded);
  const catCount = new Map<string, number>();
  for (const c of courseList) if (c.category.trim()) catCount.set(c.category.trim(), (catCount.get(c.category.trim()) ?? 0) + 1);
  const categoryOptions: Option[] = [...catCount.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "th"))
    .map(([v, n]) => ({ value: v, label: v, hint: `${n} วิชา` }));
  const usedCats = new Set([...s.homeroom_categories, ...s.field_categories, ...(s.computer_categories ?? [])]);
  const unassigned = categoryOptions.filter((o) => !usedCats.has(o.value));
  const roomOptions: Option[] = [...(rooms.data ?? [])]
    .filter((r) => r.kind !== "field")
    .sort((a, b) => Number(b.kind === "meeting") - Number(a.kind === "meeting") || b.capacity - a.capacity)
    .map((r) => ({ value: r.name, label: r.name, hint: `จุ ${r.capacity} คน` }));
  const courseOptions: Option[] = courseList.map((c) => ({ value: c.code, label: `${c.code} ${c.name}` }));
  const keywordHits = courseList.filter((c) => s.internship_keywords.some((k) => k && c.name.includes(k)));
  const adminCount = (teachers.data ?? []).filter((t) => t.is_admin && !t.is_excluded).length;
  const teachPeriods = s.periods.filter((p) => !s.lunch_periods.includes(p.no));

  async function save() {
    setSaving(true);
    setSaveError("");
    try {
      await api.put("/api/settings", s);
      toast.ok("บันทึกการตั้งค่าแล้ว");
      reload();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    try {
      await api.post("/api/settings/reset");
      toast.ok("คืนค่าเริ่มต้นแล้ว");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div>
      <PageHeader
        title="ตั้งค่าเงื่อนไข"
        subtitle="ช่วงเวลาเรียนและเงื่อนไขที่ใช้จัดตาราง (ค่าเริ่มต้นตามกฎของหลักสูตร)"
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={reset}>
              คืนค่าเริ่มต้น
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          </>
        }
      />
      {data && data.problems.length > 0 && (
        <div className="mb-4">
          <Alert tone="error">การตั้งค่าเวลาไม่ถูกต้อง: {data.problems.join(", ")}</Alert>
        </div>
      )}
      {saveError && (
        <div className="mb-4">
          <Alert tone="error">{saveError}</Alert>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="card">
          <h2 className="mb-4 font-bold">ช่วงเวลาเรียน</h2>
          <Field label="วันที่เปิดสอน" hint="คั่นด้วยจุลภาค เรียงตามลำดับ">
            <input className="input" value={listText(s.days)} onChange={(e) => set("days", parseList(e.target.value))} />
          </Field>
          <div className="mt-4">
            <span className="label">คาบเรียน (เลือกช่อง “พัก” สำหรับเวลาพักกลางวัน)</span>
            <div className="space-y-2">
              {s.periods.map((p, i) => (
                <div key={p.no} className="grid grid-cols-[3.25rem_minmax(0,1fr)_minmax(0,1fr)_auto_2.5rem] items-center gap-2">
                  <span className="text-sm font-medium text-slate-600">คาบ {p.no}</span>
                  <input
                    className="input"
                    value={p.start}
                    aria-label={`เวลาเริ่มคาบ ${p.no}`}
                    onChange={(e) => set("periods", s.periods.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                  />
                  <input
                    className="input"
                    value={p.end}
                    aria-label={`เวลาสิ้นสุดคาบ ${p.no}`}
                    onChange={(e) => set("periods", s.periods.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                  />
                  <label className="flex min-h-10 cursor-pointer items-center gap-1.5 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-600"
                      checked={s.lunch_periods.includes(p.no)}
                      onChange={(e) =>
                        set("lunch_periods", e.target.checked ? [...s.lunch_periods, p.no].sort((a, b) => a - b) : s.lunch_periods.filter((x) => x !== p.no))
                      }
                    />
                    พัก
                  </label>
                  <button
                    type="button"
                    className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                    disabled={i !== s.periods.length - 1}
                    aria-label="ลบคาบสุดท้าย"
                    onClick={() => {
                      set("periods", s.periods.slice(0, -1));
                      set("lunch_periods", s.lunch_periods.filter((x) => x !== p.no));
                    }}
                  >
                    <IconTrash />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-ghost mt-3"
              onClick={() => {
                const last = s.periods[s.periods.length - 1];
                set("periods", [...s.periods, { no: s.periods.length + 1, start: last?.end ?? "08:00", end: last?.end ?? "09:00" }]);
              }}
            >
              <IconPlus /> เพิ่มคาบ
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card">
            <h2 className="mb-4 font-bold">เงื่อนไขการจัด</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="คาบติดกันสูงสุดต่อชุด">
                <input className="input" type="number" min={1} value={s.max_block} onChange={(e) => set("max_block", Number(e.target.value))} />
              </Field>
              <Field label="คาบว่างระหว่างวันสูงสุด" hint="ไม่นับเวลาพักกลางวัน">
                <input className="input" type="number" min={0} value={s.max_gap} onChange={(e) => set("max_gap", Number(e.target.value))} />
              </Field>
              <Field label="เวลาประมวลผลสูงสุด (วินาที)" hint="ถ้าพิสูจน์ได้ว่าดีที่สุดแล้วจะหยุดก่อนเวลา">
                <input className="input" type="number" min={2} max={120} value={s.time_budget_sec} onChange={(e) => set("time_budget_sec", Number(e.target.value))} />
              </Field>
              <Field label="ตัวจัดตาราง">
                <select className="input" value={s.solver ?? "cpsat"} onChange={(e) => set("solver", e.target.value as Settings["solver"])}>
                  <option value="cpsat">CP-SAT (แนะนำ จัดได้ครบที่สุด)</option>
                  <option value="greedy">วิธีละโมบ (เร็ว แต่อาจจัดไม่ครบ)</option>
                </select>
              </Field>
              <label className="flex min-h-10 cursor-pointer items-center gap-2.5 self-end text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={s.avoid_last_period} onChange={(e) => set("avoid_last_period", e.target.checked)} />
                หลีกเลี่ยงคาบท้ายของวัน
              </label>
            </div>
          </div>
        </div>

        <div className="card lg:col-span-2">
          <h2 className="mb-1 font-bold">ช่วงเวลาที่กำหนดตายตัว</h2>
          <p className="mb-4 text-sm text-slate-500">
            ห้ามจัดการเรียนการสอนในช่วงเหล่านี้ คาบพบอาจารย์ที่ปรึกษาและกิจกรรมใช้กับทุกห้องทุกชั้นปี (คาบพบที่ปรึกษากันเวลาอาจารย์ที่ปรึกษาด้วย)
            ส่วนประชุมฝ่ายบริหารใช้กับอาจารย์ในชีต “ฝ่ายบริหาร”
          </p>
          <div className="space-y-3">
            {[...s.common_blocks.map((b, i) => ({ b, i })), ...(s.admin_meeting ? [{ b: s.admin_meeting, i: -1 }] : [])].map(({ b, i }) => {
              const update = (patch: Partial<typeof b>) => {
                if (i === -1) set("admin_meeting", { ...b, ...patch });
                else set("common_blocks", s.common_blocks.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              };
              return (
                <div key={i} className="grid items-end gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
                  <Field label="ชื่อ">
                    <input className="input" value={b.name} onChange={(e) => update({ name: e.target.value })} />
                  </Field>
                  <Field label="ใช้กับ">
                    {i === -1 ? (
                      <input className="input" disabled value={`อาจารย์ฝ่ายบริหาร ${adminCount} คน`} />
                    ) : (
                      <select className="input" value={b.kind ?? "activity"} onChange={(e) => update({ kind: e.target.value as "advisor" | "activity" })}>
                        <option value="advisor">ทุกกลุ่ม + อาจารย์ที่ปรึกษา</option>
                        <option value="activity">ทุกกลุ่ม</option>
                      </select>
                    )}
                  </Field>
                  <Field label="วัน">
                    <select className="input" value={b.day} onChange={(e) => update({ day: Number(e.target.value) })}>
                      {s.days.map((d, di) => (
                        <option key={d} value={di}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="ตั้งแต่คาบ">
                    <PeriodSelect label={`${b.name} ตั้งแต่คาบ`} value={b.start} periods={teachPeriods} onChange={(n) => update({ start: n, end: Math.max(n, b.end) })} />
                  </Field>
                  <Field label="ถึงคาบ">
                    <PeriodSelect label={`${b.name} ถึงคาบ`} value={b.end} periods={teachPeriods.filter((p) => p.no >= b.start)} onChange={(n) => update({ end: n })} />
                  </Field>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card lg:col-span-2">
          <h2 className="mb-1 font-bold">หมวดวิชาและสถานที่</h2>
          <p className="mb-4 text-sm text-slate-500">เลือกจากหมวดวิชา ห้อง และรายวิชาที่มีในข้อมูลปัจจุบัน ตัวเลขในวงเล็บคือจำนวนรายวิชาหรือความจุ</p>
          {(courses.loading || rooms.loading) && <Spinner />}
          <div className="grid gap-5 md:grid-cols-2 [&>*]:min-w-0">
            <ChipSelect
              label="ห้องสำหรับเรียนรวม (ใช้ก่อน)"
              hint="วิชาเรียนรวมทั้งชั้นปีใช้ห้องเหล่านี้ก่อน เรียงตามลำดับที่เลือก"
              values={s.combined_rooms}
              options={roomOptions}
              addLabel="+ เพิ่มห้อง"
              onChange={(v) => set("combined_rooms", v)}
            />
            <ChipSelect
              label="หมวดที่เรียนที่ห้องประจำของกลุ่ม"
              values={s.homeroom_categories}
              options={categoryOptions}
              addLabel="+ เพิ่มหมวดวิชา"
              onChange={(v) => set("homeroom_categories", v)}
            />
            <ChipSelect
              label="หมวดที่ใช้ห้องเรียนและโรงยิม/สนามพร้อมกัน (กีฬา)"
              values={s.field_categories}
              options={categoryOptions}
              addLabel="+ เพิ่มหมวดวิชา"
              onChange={(v) => set("field_categories", v)}
            />
            <ChipSelect
              label="หมวดที่เรียนในห้องคอมพิวเตอร์"
              values={s.computer_categories ?? []}
              options={categoryOptions}
              addLabel="+ เพิ่มหมวดวิชา"
              onChange={(v) => set("computer_categories", v)}
            />
            <ChipSelect
              label="วิชาฝึกงาน (ไม่จัดลงตาราง)"
              values={s.internship_codes}
              options={courseOptions}
              addLabel="+ เพิ่มรายวิชา"
              onChange={(v) => set("internship_codes", v)}
            />
            <Field
              label="คำในชื่อวิชาฝึกงาน (ไม่จัดลงตาราง)"
              hint={
                keywordHits.length
                  ? `ตรงกับ ${keywordHits.length} วิชา: ${keywordHits.map((c) => c.code).join(", ")} (ใช้เฉพาะวิชาที่ไม่มีชั่วโมงเรียนรายสัปดาห์)`
                  : "คั่นด้วยจุลภาค ยังไม่ตรงกับรายวิชาใด"
              }
            >
              <input className="input" value={listText(s.internship_keywords)} onChange={(e) => set("internship_keywords", parseList(e.target.value))} />
            </Field>
          </div>
          {unassigned.length > 0 && (
            <div className="mt-4 rounded-xl border border-sun-200 bg-sun-50 px-3 py-2 text-sm text-slate-700">
              <span className="font-semibold text-sun-700">หมวดที่ยังไม่ได้กำหนด:</span> {unassigned.map((o) => `${o.value} (${o.hint})`).join(", ")}
              <span className="block text-xs text-slate-500">วิชาในหมวดเหล่านี้ใช้ห้องเรียนทั่วไปตามความจุ</span>
            </div>
          )}
        </div>
      </div>
      {toast.node}
    </div>
  );
}

// ---------------- บัญชีผู้ใช้ ----------------

interface UserRow extends User {
  linked_name: string;
  linked_ok: boolean;
}

interface Target {
  id: number;
  code: string;
  name: string;
  is_excluded: boolean;
}

const ROLE_LABEL: Record<Role, string> = { staff: "ผู้ดูแลเว็บไซต์", teacher: "อาจารย์", student: "นักเรียน" };

function StatusBadge({ u }: { u: UserRow }) {
  if (!u.is_active)
    return (
      <Badge tone="muted" strike>
        ปิดใช้งาน
      </Badge>
    );
  if (u.must_change_password) return <Badge tone="warn">ยังไม่เปลี่ยนรหัส</Badge>;
  return <Badge tone="ok">ใช้งานอยู่</Badge>;
}

export function UsersPage() {
  const { user: me } = useAuth();
  const { data, loading, error, reload } = useApi<UserRow[]>("/api/auth/users");
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
  const [deleteFor, setDeleteFor] = useState<UserRow | null>(null);
  const [bulkResult, setBulkResult] = useState<{ role: string; count: number } | null>(null);
  const toast = useToast();

  async function toggle(u: UserRow) {
    try {
      await api.patch(`/api/auth/users/${u.id}`, { is_active: !u.is_active });
      toast.ok(u.is_active ? "ปิดใช้งานแล้ว" : "เปิดใช้งานแล้ว");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove(u: UserRow) {
    try {
      await api.del(`/api/auth/users/${u.id}`);
      toast.ok("ลบบัญชีแล้ว");
      setDeleteFor(null);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function bulk(role: "teacher" | "student") {
    try {
      const res = await api.post<{ role: string; created: { username: string; password: string; display_name: string; code: string }[] }>(
        "/api/auth/users/bulk",
        { role },
      );
      if (res.created.length) {
        // ดาวน์โหลดได้ครั้งเดียวตอนสร้าง เพราะรหัสผ่านจะไม่แสดงอีก
        const rows = [["ชื่อผู้ใช้", "รหัสผ่านเริ่มต้น", "ชื่อแสดง", "รหัส"], ...res.created.map((c) => [c.username, c.password, c.display_name, c.code])];
        saveBlob(csvBlob(rows), `บัญชีผู้ใช้-${role}.csv`);
      }
      setBulkResult({ role, count: res.created.length });
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div>
      <PageHeader
        title="บัญชีผู้ใช้"
        subtitle="อาจารย์ดูได้เฉพาะตารางสอนของตนเอง นักเรียนดูได้เฉพาะตารางของกลุ่มเรียนที่ผูกไว้"
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => bulk("student")}>
              สร้างบัญชีกลุ่มเรียนอัตโนมัติ
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <IconPlus /> สร้างบัญชี
            </button>
          </>
        }
      />
      {loading && <Spinner />}
      {error && <Alert tone="error">{error}</Alert>}
      {data && (
        <div className="card relative overflow-x-auto p-0">
          <table className="data-table">
            <thead>
              <tr>
                <th>ชื่อผู้ใช้</th>
                <th>ชื่อแสดง</th>
                <th>บทบาท</th>
                <th>ผูกกับ</th>
                <th>สถานะ</th>
                <th>เข้าระบบล่าสุด</th>
                <th className="text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium">{u.username}</td>
                  <td>{u.display_name}</td>
                  <td>
                    <Badge tone={u.role === "staff" ? "info" : u.role === "teacher" ? "ok" : "purple"}>{ROLE_LABEL[u.role] ?? u.role}</Badge>
                  </td>
                  <td className={u.linked_ok ? "text-slate-600" : "text-red-600"}>{u.linked_name}</td>
                  <td>
                    <StatusBadge u={u} />
                  </td>
                  <td className="whitespace-nowrap text-slate-500">{formatDateTime(u.last_login_at)}</td>
                  <td className="text-right whitespace-nowrap">
                    <span className="inline-flex gap-2">
                      <button type="button" className="btn btn-ghost" onClick={() => setResetFor(u)}>
                        ตั้งรหัสใหม่
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => toggle(u)}>
                        {u.is_active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                      </button>
                      <button type="button" className="btn btn-danger" disabled={me?.id === u.id} onClick={() => setDeleteFor(u)}>
                        ลบ
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateUserModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          toast.ok("สร้างบัญชีแล้ว ผู้ใช้ต้องเปลี่ยนรหัสผ่านเมื่อเข้าระบบครั้งแรก");
          reload();
        }}
      />
      <ResetPasswordModal
        user={resetFor}
        onClose={() => setResetFor(null)}
        onDone={() => {
          setResetFor(null);
          toast.ok("ตั้งรหัสผ่านใหม่แล้ว เจ้าของบัญชีต้องเปลี่ยนรหัสเมื่อเข้าระบบ");
          reload();
        }}
      />
      <Modal
        open={deleteFor !== null}
        title="ยืนยันการลบบัญชี"
        onClose={() => setDeleteFor(null)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleteFor(null)}>
              ยกเลิก
            </button>
            <button type="button" className="btn btn-danger" onClick={() => deleteFor && remove(deleteFor)}>
              ลบบัญชี
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          ต้องการลบบัญชี <span className="font-semibold">{deleteFor?.username}</span> ใช่หรือไม่
        </p>
      </Modal>
      <Modal
        open={bulkResult !== null}
        title="สร้างบัญชีอัตโนมัติ"
        onClose={() => setBulkResult(null)}
        footer={
          <button type="button" className="btn btn-primary" onClick={() => setBulkResult(null)}>
            เข้าใจแล้ว
          </button>
        }
      >
        {bulkResult && bulkResult.count > 0 ? (
          <div className="space-y-3 text-sm">
            <Alert tone="ok">สร้างบัญชี{ROLE_LABEL[bulkResult.role as Role]} {bulkResult.count} บัญชี และดาวน์โหลดไฟล์ CSV แล้ว</Alert>
            <Alert tone="warn">ไฟล์นี้ดาวน์โหลดได้ครั้งเดียว ระบบจะไม่แสดงรหัสผ่านอีก กรุณาเก็บไฟล์ไว้ในที่ปลอดภัยและแจกให้เจ้าของบัญชี</Alert>
          </div>
        ) : (
          <p className="text-sm text-slate-600">ทุกรายการมีบัญชีอยู่แล้ว ไม่มีบัญชีใหม่ที่ต้องสร้าง</p>
        )}
      </Modal>
      {toast.node}
    </div>
  );
}

function CreateUserModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [role, setRole] = useState<Role>("teacher");
  const [scope, setScope] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const targets = useApi<Target[]>(open && role !== "staff" ? `/api/auth/targets?role=${role}` : null);

  useEffect(() => {
    if (open) {
      setScope("");
      setUsername("");
      setDisplayName("");
      setPassword("");
      setError("");
    }
  }, [open, role]);

  const target = targets.data?.find((t) => String(t.id) === scope);
  const complete = username.trim() && password.length >= MIN_PASSWORD_LENGTH && (role === "staff" || scope);

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api.post("/api/auth/users", {
        username,
        password,
        role,
        scope_id: role === "staff" ? null : Number(scope),
        display_name: displayName,
      });
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="สร้างบัญชีผู้ใช้"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="button" className="btn btn-primary" disabled={!complete || busy} onClick={save}>
            {busy ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="บทบาท">
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="teacher">อาจารย์</option>
            <option value="student">นักเรียน (กลุ่มเรียน)</option>
            <option value="staff">ผู้ดูแลเว็บไซต์</option>
          </select>
        </Field>
        {role !== "staff" && (
          <Field label={role === "teacher" ? "อาจารย์" : "กลุ่มเรียน"}>
            <select
              className="input"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
              }}
            >
              <option value="">— เลือก —</option>
              {(targets.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {role === "teacher" ? t.name : `${t.code} ${t.name}`}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="ชื่อผู้ใช้" hint="ตั้งเอง ตัวพิมพ์เล็ก ไม่มีช่องว่าง">
          <input className="input" value={username} autoComplete="off" onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="ชื่อแสดง (ไม่บังคับ)">
          <input className="input" value={displayName} placeholder={target?.name ?? (role === "staff" ? "ผู้ดูแลเว็บไซต์" : "")} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="รหัสผ่านเริ่มต้น" hint={`อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร ผู้ใช้ต้องเปลี่ยนเมื่อเข้าระบบครั้งแรก`}>
          <input className="input" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: UserRow | null; onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPw("");
    setError("");
  }, [user]);

  async function save() {
    if (!user) return;
    setBusy(true);
    try {
      await api.patch(`/api/auth/users/${user.id}`, { password: pw });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={user !== null}
      title={`ตั้งรหัสผ่านใหม่: ${user?.username ?? ""}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="button" className="btn btn-primary" disabled={pw.length < MIN_PASSWORD_LENGTH || busy} onClick={save}>
            บันทึก
          </button>
        </>
      }
    >
      <Field label="รหัสผ่านใหม่" hint={`อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร เจ้าของบัญชีต้องเปลี่ยนรหัสเองเมื่อเข้าระบบ และโทเคนเดิมจะใช้ไม่ได้ทันที`}>
        <input className="input" type="text" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} />
      </Field>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
    </Modal>
  );
}

// ---------------- สำรองและล้างข้อมูล ----------------

export function BackupPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState<null | "restore" | "data" | "schedules" | "all">(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function run() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm === "restore" && file) {
        const fd = new FormData();
        fd.append("file", file);
        await api.post("/api/backup/restore", fd);
        toast.ok("กู้คืนข้อมูลแล้ว");
        setFile(null);
      } else {
        await api.post("/api/backup/clear", { target: confirm });
        toast.ok("ล้างข้อมูลแล้ว");
      }
      setConfirm(null);
      setTyped("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const labels: Record<string, string> = {
    restore: "กู้คืนจากไฟล์สำรอง (ข้อมูลพื้นฐาน การตั้งค่า และตารางสอนเดิมจะถูกแทนที่)",
    data: "ล้างข้อมูลพื้นฐานทั้งหมด (อาจารย์ รายวิชา กลุ่มเรียน ห้อง การเปิดสอน เวลาที่ไม่ว่าง)",
    schedules: "ล้างตารางสอนทุกรุ่น",
    all: "ล้างข้อมูลพื้นฐานและตารางสอนทั้งหมด",
  };

  return (
    <div>
      <PageHeader title="สำรองและล้างข้อมูล" subtitle="บัญชีผู้ใช้ไม่ถูกรวมในไฟล์สำรองและไม่ถูกล้าง" />
      <div className="mb-4">
        <Alert tone="warn">
          บนเซิร์ฟเวอร์แผนฟรี ข้อมูลอาจหายเมื่อระบบรีสตาร์ตหรือ deploy ใหม่ ควรดาวน์โหลดไฟล์สำรองเก็บไว้ทุกครั้งหลังแก้ไขข้อมูลสำคัญ
        </Alert>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2 className="mb-1 font-bold">สำรองข้อมูล</h2>
          <p className="mb-4 text-sm text-slate-500">ดาวน์โหลดข้อมูลพื้นฐาน การตั้งค่า และตารางสอนทุกรุ่นเป็นไฟล์ JSON</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => downloadFile("/api/backup", "สำรองข้อมูลตารางสอน.json").catch((e) => toast.error(e.message))}
          >
            <IconArrowDown /> ดาวน์โหลดไฟล์สำรอง
          </button>
        </div>
        <div className="card">
          <h2 className="mb-1 font-bold">กู้คืนข้อมูล</h2>
          <p className="mb-4 text-sm text-slate-500">เลือกไฟล์สำรอง (.json) ที่ดาวน์โหลดจากระบบนี้</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
              <IconUpload /> {file ? file.name : "เลือกไฟล์"}
            </button>
            <button type="button" className="btn btn-primary" disabled={!file} onClick={() => setConfirm("restore")}>
              กู้คืน
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <div className="card md:col-span-2">
          <h2 className="mb-1 font-bold text-red-700">ล้างข้อมูล</h2>
          <p className="mb-4 text-sm text-slate-500">ไม่สามารถย้อนกลับได้ ควรสำรองข้อมูลก่อน</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-danger" onClick={() => setConfirm("schedules")}>
              ล้างตารางสอนทุกรุ่น
            </button>
            <button type="button" className="btn btn-danger" onClick={() => setConfirm("data")}>
              ล้างข้อมูลพื้นฐาน
            </button>
            <button type="button" className="btn btn-danger" onClick={() => setConfirm("all")}>
              ล้างทั้งหมด
            </button>
          </div>
        </div>
      </div>
      <Modal
        open={confirm !== null}
        title="ยืนยันการดำเนินการ"
        onClose={() => {
          setConfirm(null);
          setTyped("");
        }}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>
              ยกเลิก
            </button>
            <button type="button" className="btn btn-danger" disabled={typed !== "ยืนยัน" || busy} onClick={run}>
              {busy ? "กำลังดำเนินการ…" : "ดำเนินการ"}
            </button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-700">{confirm && labels[confirm]}</p>
        <Field label="พิมพ์คำว่า “ยืนยัน” เพื่อดำเนินการ">
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
      </Modal>
      {toast.node}
    </div>
  );
}

// ---------------- ประวัติ ----------------

export function ChangesPage() {
  const [q, setQ] = useState("");
  const { data, loading, error } = useApi<{ id: number; at: string; username: string; action: string; entity: string; detail: string }[]>(
    "/api/history/changes?limit=500",
  );
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (data ?? []).filter((r) => !n || `${r.username} ${r.action} ${r.entity} ${r.detail}`.toLowerCase().includes(n));
  }, [data, q]);
  return (
    <div>
      <PageHeader title="ประวัติการแก้ไข" subtitle="บันทึกการเพิ่ม แก้ไข ลบ นำเข้า และการจัดการบัญชี (ไม่บันทึกรหัสผ่าน)" />
      <div className="card p-0">
        <div className="border-b border-slate-200 p-4">
          <input className="input sm:max-w-xs" placeholder="ค้นหา…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา" />
        </div>
        {loading && <Spinner />}
        {error && <div className="p-4"><Alert tone="error">{error}</Alert></div>}
        {data && rows.length === 0 && <div className="p-4"><EmptyState title="ยังไม่มีประวัติ" /></div>}
        {rows.length > 0 && (
          <div className="relative overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>ผู้ใช้</th>
                  <th>การกระทำ</th>
                  <th>ส่วน</th>
                  <th>รายละเอียด</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-slate-500">{formatDateTime(r.at)}</td>
                    <td>{r.username}</td>
                    <td>
                      <Badge tone={r.action.includes("ลบ") || r.action.includes("ล้าง") ? "error" : "info"}>{r.action}</Badge>
                    </td>
                    <td className="text-slate-600">{r.entity}</td>
                    <td className="text-slate-600">{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function RunsPage() {
  const { data, loading, error } = useApi<
    { id: number; at: string; username: string; version_id: number | null; duration_ms: number; placed_hours: number; total_hours: number; errors: number; warnings: number; relaxed_gap: boolean; message: string }[]
  >("/api/history/runs");
  return (
    <div>
      <PageHeader title="ประวัติการประมวลผล" subtitle="ผลการจัดตารางแต่ละครั้ง" />
      <div className="card p-0">
        {loading && <Spinner />}
        {error && <div className="p-4"><Alert tone="error">{error}</Alert></div>}
        {data && data.length === 0 && <div className="p-4"><EmptyState title="ยังไม่เคยจัดตาราง" /></div>}
        {data && data.length > 0 && (
          <div className="relative overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>ผู้ใช้</th>
                  <th>จัดได้</th>
                  <th>ผลตรวจ</th>
                  <th>ใช้เวลา</th>
                  <th>สรุป</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-slate-500">{formatDateTime(r.at)}</td>
                    <td>{r.username}</td>
                    <td className="whitespace-nowrap tabular-nums">
                      {r.placed_hours}/{r.total_hours}
                    </td>
                    <td>
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={r.errors ? "error" : "ok"}>ผิดพลาด {r.errors}</Badge>
                        <Badge tone={r.warnings ? "warn" : "ok"}>เตือน {r.warnings}</Badge>
                        {r.relaxed_gap && <Badge tone="warn">ผ่อนคาบว่าง</Badge>}
                      </span>
                    </td>
                    <td className="tabular-nums">{(r.duration_ms / 1000).toFixed(1)} วิ</td>
                    <td className="text-slate-600">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
