import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { IconArrowRight, IconX } from "../components/Icons";
import Stepper from "../components/Stepper";
import { Alert, Badge, PageHeader, Spinner, useApi, useToast } from "../components/ui";
import { api } from "../lib/api";
import type { Curriculum, CurriculumGroup, CurriculumRow, Settings, Summary } from "../lib/types";

// หน้ากรอกข้อมูล: กรอกแบบเดียวกับไฟล์ Excel "ข้อมูลหลักสูตร"
// ชีตชั้นปี (กลุ่มเรียน → รายวิชา) · ฝ่ายบริหาร · สถานที่เรียน
// บันทึกแล้วระบบอ่านด้วยตัวนำเข้าเดียวกับไฟล์ Excel จึงได้ผลเหมือนนำเข้าไฟล์

const COMBINED = "เรียนรวมทั้งชั้นปี";
const ELECTIVE = "เลือกเรียน 1 รายวิชา";

type Row = CurriculumRow & { _k: number };
type Group = Omit<CurriculumGroup, "rows"> & { _k: number; rows: Row[] };
type Year = { year: number; groups: Group[] };
type Lecture = { _k: number; name: string; note: string };
type Practice = { _k: number; place: string; note: string };
interface Model {
  years: Year[];
  admins: { _k: number; name: string }[];
  lecture: Lecture[];
  practice: Practice[];
}

let seq = 0;
const key = () => ++seq;

/** แยกช่องหน่วยกิตเป็น หน่วยกิต + เรียนรวม + เลือกเรียน (ในไฟล์เขียนรวมในช่องเดียว) */
function splitCredits(raw: string | null) {
  let s = raw ?? "";
  const combined = s.includes("เรียนรวม");
  const elective = s.includes("เลือกเรียน");
  s = s.replace(/เรียนรวม\s*(ทั้งชั้นปี)?/g, "").replace(/เลือกเรียน\s*\d*\s*(รายวิชา)?/g, "");
  return { base: s.replace(/\s+/g, " ").trim(), combined, elective };
}

function joinCredits(base: string, combined: boolean, elective: boolean) {
  return [base.trim(), combined ? COMBINED : "", elective ? ELECTIVE : ""].filter(Boolean).join(" ");
}

/** จำนวนคาบต่อสัปดาห์ = ทฤษฎี + ปฏิบัติ หรือ "เรียน N ชม." */
function periodsOf(credits: string | null) {
  const m = /\((\d+)\s*-\s*(\d+)\s*-\s*\d+\)/.exec(credits ?? "");
  if (m) return Number(m[1]) + Number(m[2]);
  const h = /เรียน\s*(\d+)\s*ชม/.exec(credits ?? "");
  return h ? Number(h[1]) : 0;
}

const isMember = (rows: Row[], i: number) => i > 0 && (rows[i].no === null || rows[i].no === undefined);

function fromApi(c: Curriculum): Model {
  return {
    years: c.years.map((y) => ({
      year: y.year,
      groups: y.groups.map((g) => ({ ...g, _k: key(), rows: g.rows.map((r) => ({ ...r, _k: key() })) })),
    })),
    admins: c.admins.map((name) => ({ _k: key(), name })),
    lecture: c.lecture.map((x) => ({ ...x, _k: key() })),
    practice: c.practice.map((x) => ({ ...x, _k: key() })),
  };
}

function toApi(m: Model): Curriculum {
  return {
    years: m.years.map((y) => ({
      year: y.year,
      groups: y.groups.map((g) => {
        let n = 0;
        return {
          code: g.code.trim(),
          size: Number(g.size) || 0,
          rows: g.rows
            .filter((r) => r.code.trim() || r.name.trim())
            .map((r, i, rows) => {
              const member = isMember(rows as Row[], i);
              if (!member) n += 1;
              return {
                no: member ? null : n,
                code: r.code.trim(),
                name: r.name.trim(),
                teachers: r.teachers.trim(),
                places: r.places.trim(),
                credits: member ? null : (r.credits ?? "").trim(),
                category: member ? null : (r.category ?? "").trim(),
              };
            }),
        };
      }),
    })),
    admins: m.admins.map((a) => a.name.trim()).filter(Boolean),
    lecture: m.lecture.filter((x) => x.name.trim()).map(({ name, note }) => ({ name: name.trim(), note: note.trim() })),
    practice: m.practice.filter((x) => x.place.trim() || x.note.trim()).map(({ place, note }) => ({ place: place.trim(), note: note.trim() })),
  };
}

/** ตรวจก่อนบันทึก: ข้อที่ทำให้ตัวนำเข้าอ่านข้อมูลไม่ได้ */
function problems(m: Model): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const y of m.years) {
    for (const g of y.groups) {
      const code = g.code.trim();
      if (!new RegExp(`^${y.year}/\\d+$`).test(code)) out.push(`ชั้นปีที่ ${y.year}: รหัสกลุ่ม “${code || "(ว่าง)"}” ต้องเป็นรูปแบบ ${y.year}/1`);
      else if (seen.has(code)) out.push(`กลุ่ม ${code} ซ้ำ`);
      seen.add(code);
      g.rows.forEach((r, i) => {
        if (!r.code.trim() && !r.name.trim()) return;
        const where = `กลุ่ม ${code || "?"} แถว ${i + 1}`;
        if (!r.code.trim()) out.push(`${where}: ยังไม่กรอกรหัสวิชา`);
        if (!r.name.trim()) out.push(`${where}: ยังไม่กรอกชื่อรายวิชา`);
        if (!isMember(g.rows, i) && !splitCredits(r.credits).base) out.push(`${where}: ยังไม่กรอกหน่วยกิต`);
      });
    }
  }
  return out;
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="label md:sr-only">{label}</span>
      {children}
    </label>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <IconX width={16} height={16} />
    </button>
  );
}

const ROW_GRID = "md:grid md:grid-cols-[2.25rem_6.5rem_minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_8.5rem_minmax(0,1.1fr)_2.5rem] md:items-start md:gap-2";

function GroupCard({
  g,
  year,
  onChange,
  onRemove,
}: {
  g: Group;
  year: number;
  onChange: (g: Group) => void;
  onRemove: () => void;
}) {
  const setRow = (i: number, patch: Partial<Row>) => onChange({ ...g, rows: g.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const blank = (no: number | null): Row => ({ _k: key(), no, code: "", name: "", teachers: "", places: "", credits: no === null ? null : "", category: no === null ? null : "" });
  const lastMember = (i: number) => {
    let j = i;
    while (j + 1 < g.rows.length && isMember(g.rows, j + 1)) j++;
    return j;
  };
  function removeRow(i: number) {
    let rows = [...g.rows];
    if (!isMember(rows, i) && i + 1 < rows.length && isMember(rows, i + 1)) {
      // ลบวิชาแรกของกลุ่มเลือก: ให้วิชาถัดไปเป็นวิชาแรกแทน (รับหน่วยกิตและกลุ่มวิชาต่อ)
      rows[i + 1] = { ...rows[i + 1], no: 1, credits: rows[i].credits, category: rows[i].category };
    }
    rows = rows.filter((_, j) => j !== i);
    onChange({ ...g, rows });
  }
  function toggleElective(i: number, on: boolean) {
    const c = splitCredits(g.rows[i].credits);
    let rows = g.rows.map((r, j) => (j === i ? { ...r, credits: joinCredits(c.base, c.combined, on) } : r));
    if (!on) {
      // เลิกเป็นวิชาเลือก: วิชาในกลุ่มเลือกที่ต่อท้ายกลายเป็นรายวิชาแยก (ต้องกรอกหน่วยกิตเอง)
      rows = rows.map((r, j) => (j > i && j <= lastMember(i) ? { ...r, no: 1, credits: "", category: g.rows[i].category } : r));
    }
    onChange({ ...g, rows });
  }
  function addMember(i: number) {
    const at = lastMember(i) + 1;
    const rows = [...g.rows];
    rows.splice(at, 0, blank(null));
    onChange({ ...g, rows });
  }

  let n = 0;
  let periods = 0;
  for (let i = 0; i < g.rows.length; i++) {
    if ((g.rows[i].code || g.rows[i].name) && !isMember(g.rows, i)) {
      n += 1;
      periods += periodsOf(g.rows[i].credits);
    }
  }

  return (
    <section className="card">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block w-32">
          <span className="label">กลุ่มเรียน</span>
          <input className="input" value={g.code} placeholder={`${year}/1`} onChange={(e) => onChange({ ...g, code: e.target.value })} />
        </label>
        <label className="block w-32">
          <span className="label">จำนวน (คน)</span>
          <input className="input tabular-nums" type="number" min={0} value={g.size || ""} onChange={(e) => onChange({ ...g, size: Number(e.target.value) })} />
        </label>
        <span className="pb-2.5 text-sm text-slate-500 tabular-nums">
          รวม {n} รายวิชา {periods} คาบ
        </span>
        <button type="button" className="btn btn-danger ml-auto" onClick={onRemove}>
          ลบกลุ่มเรียน
        </button>
      </div>

      <div className={`hidden border-b border-slate-200 pb-2 text-xs font-semibold text-slate-500 ${ROW_GRID}`}>
        <span>ที่</span>
        <span>รหัสวิชา</span>
        <span>ชื่อรายวิชา</span>
        <span>อาจารย์ผู้สอน</span>
        <span>สถานที่ที่ใช้</span>
        <span>หน่วยกิต</span>
        <span>กลุ่มวิชา</span>
        <span />
      </div>

      {g.rows.length === 0 && <p className="py-4 text-sm text-slate-400">ยังไม่มีรายวิชา</p>}
      <ul className="divide-y divide-slate-100">
        {(() => {
          let no = 0;
          return g.rows.map((r, i) => {
            const member = isMember(g.rows, i);
            if (!member) no += 1;
            const c = splitCredits(r.credits);
            return (
              <li
                key={r._k}
                className={`grid grid-cols-2 gap-2 py-3 ${ROW_GRID} ${member ? "border-l-2 border-sky-300 bg-sky-50/40 pl-2 md:pl-0" : ""}`}
              >
                <div className="col-span-2 flex items-center justify-between md:col-span-1 md:block md:pt-2.5">
                  <span className={`text-sm font-semibold tabular-nums ${member ? "text-sky-700" : "text-slate-600"}`}>
                    {member ? <span title="วิชาในกลุ่มเลือกเดียวกัน">↳</span> : no}
                    <span className="ml-1 text-xs font-normal text-slate-400 md:hidden">{member ? "วิชาในกลุ่มเลือกเดียวกัน" : "รายวิชา"}</span>
                  </span>
                  <span className="md:hidden">
                    <RemoveButton label="ลบแถวนี้" onClick={() => removeRow(i)} />
                  </span>
                </div>
                <Field label="รหัสวิชา">
                  <input className="input" value={r.code} placeholder="พล 051383" aria-label="รหัสวิชา" onChange={(e) => setRow(i, { code: e.target.value })} />
                </Field>
                <Field label="ชื่อรายวิชา">
                  <input className="input" value={r.name} aria-label="ชื่อรายวิชา" onChange={(e) => setRow(i, { name: e.target.value })} />
                </Field>
                <Field label="อาจารย์ผู้สอน" className="col-span-2 md:col-span-1">
                  <input
                    className="input"
                    value={r.teachers}
                    list="mt-teachers"
                    placeholder="หลายคนคั่นด้วย ,"
                    aria-label="อาจารย์ผู้สอน"
                    onChange={(e) => setRow(i, { teachers: e.target.value })}
                  />
                </Field>
                <Field label="สถานที่ที่ใช้" className="col-span-2 md:col-span-1">
                  <input
                    className="input"
                    value={r.places}
                    list="mt-places"
                    placeholder="ห้องบรรยาย,สนาม"
                    aria-label="สถานที่ที่ใช้"
                    onChange={(e) => setRow(i, { places: e.target.value })}
                  />
                </Field>
                {member ? (
                  <p className="col-span-2 self-center text-xs text-sky-700 md:pt-2.5">หน่วยกิตและกลุ่มวิชาตามวิชาแรกของกลุ่มเลือก</p>
                ) : (
                  <>
                    <div className="min-w-0">
                      <Field label="หน่วยกิต">
                        <input
                          className="input tabular-nums"
                          value={c.base}
                          placeholder="3(2-2-5)"
                          aria-label="หน่วยกิต"
                          onChange={(e) => setRow(i, { credits: joinCredits(e.target.value, c.combined, c.elective) })}
                        />
                      </Field>
                      <div className="mt-1.5 space-y-1 text-xs text-slate-600">
                        <label className="flex cursor-pointer items-center gap-1.5">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-brand-600"
                            checked={c.combined}
                            onChange={(e) => setRow(i, { credits: joinCredits(c.base, e.target.checked, c.elective) })}
                          />
                          เรียนรวมทั้งชั้นปี
                        </label>
                        <label className="flex cursor-pointer items-center gap-1.5">
                          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={c.elective} onChange={(e) => toggleElective(i, e.target.checked)} />
                          เลือกเรียน 1 รายวิชา
                        </label>
                      </div>
                    </div>
                    <Field label="กลุ่มวิชา">
                      <input
                        className="input"
                        value={r.category ?? ""}
                        list="mt-categories"
                        aria-label="กลุ่มวิชา"
                        onChange={(e) => setRow(i, { category: e.target.value })}
                      />
                      {c.elective && (
                        <button type="button" className="mt-1.5 cursor-pointer text-xs font-medium text-brand-600 hover:text-brand-700" onClick={() => addMember(i)}>
                          + วิชาในกลุ่มเลือกนี้
                        </button>
                      )}
                    </Field>
                  </>
                )}
                <span className="hidden md:block">
                  <RemoveButton label="ลบแถวนี้" onClick={() => removeRow(i)} />
                </span>
              </li>
            );
          });
        })()}
      </ul>
      <button type="button" className="btn btn-ghost mt-3" onClick={() => onChange({ ...g, rows: [...g.rows, blank(1)] })}>
        + เพิ่มรายวิชา
      </button>
    </section>
  );
}

function YearPanel({ y, onChange }: { y: Year; onChange: (y: Year) => void }) {
  const nextCode = () => {
    const nums = y.groups.map((g) => Number(g.code.split("/")[1])).filter((x) => Number.isFinite(x));
    return `${y.year}/${(nums.length ? Math.max(...nums) : 0) + 1}`;
  };
  return (
    <div className="space-y-4">
      {y.groups.length === 0 && (
        <Alert tone="info">ชั้นปีที่ {y.year} ยังไม่มีกลุ่มเรียน กด “เพิ่มกลุ่มเรียน” แล้วกรอกรายวิชาของกลุ่ม</Alert>
      )}
      {y.groups.map((g, gi) => (
        <GroupCard
          key={g._k}
          g={g}
          year={y.year}
          onChange={(ng) => onChange({ ...y, groups: y.groups.map((x, j) => (j === gi ? ng : x)) })}
          onRemove={() => onChange({ ...y, groups: y.groups.filter((_, j) => j !== gi) })}
        />
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onChange({ ...y, groups: [...y.groups, { _k: key(), code: nextCode(), size: 0, rows: [] }] })}
        >
          + เพิ่มกลุ่มเรียน
        </button>
        {y.groups.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost"
            title="คัดลอกรายวิชา ผู้สอน และสถานที่จากกลุ่มสุดท้าย"
            onClick={() => {
              const last = y.groups[y.groups.length - 1];
              onChange({ ...y, groups: [...y.groups, { ...last, _k: key(), code: nextCode(), rows: last.rows.map((r) => ({ ...r, _k: key() })) }] });
            }}
          >
            + เพิ่มกลุ่มโดยคัดลอกรายวิชาจากกลุ่ม {y.groups[y.groups.length - 1].code}
          </button>
        )}
      </div>
    </div>
  );
}

function AdminsPanel({ m, setM }: { m: Model; setM: (m: Model) => void }) {
  return (
    <div className="card max-w-2xl">
      <h2 className="mb-1 font-bold">อาจารย์ฝ่ายบริหาร</h2>
      <p className="mb-3 text-sm text-slate-500">ประชุมทุกวันอังคาร คาบ 1–4 ระบบจะไม่จัดสอนในช่วงเวลานั้น</p>
      <ul className="space-y-2">
        {m.admins.map((a, i) => (
          <li key={a._k} className="flex items-center gap-2">
            <input
              className="input"
              value={a.name}
              list="mt-teachers"
              aria-label={`ฝ่ายบริหารคนที่ ${i + 1}`}
              placeholder="ชื่ออาจารย์"
              onChange={(e) => setM({ ...m, admins: m.admins.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
            />
            <RemoveButton label="ลบชื่อนี้" onClick={() => setM({ ...m, admins: m.admins.filter((_, j) => j !== i) })} />
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-ghost mt-3" onClick={() => setM({ ...m, admins: [...m.admins, { _k: key(), name: "" }] })}>
        + เพิ่มชื่อ
      </button>
    </div>
  );
}

function PlacesPanel({ m, setM }: { m: Model; setM: (m: Model) => void }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card">
        <h2 className="mb-1 font-bold">สถานที่เรียนบรรยาย</h2>
        <p className="mb-3 text-sm text-slate-500">หมายเหตุบอกห้องประจำกลุ่มและความจุ เช่น “ห้องเรียนประจำนักศึกษาปีที่ 1/1 · ความจุ 40 คน”</p>
        <ul className="space-y-3">
          {m.lecture.map((x, i) => (
            <li key={x._k} className="grid grid-cols-[minmax(0,1fr)_2.5rem] gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_2.5rem]">
              <input
                className="input"
                value={x.name}
                placeholder="ชื่อห้อง"
                aria-label="ชื่อห้อง"
                onChange={(e) => setM({ ...m, lecture: m.lecture.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) })}
              />
              <input
                className="input order-3 col-span-2 sm:order-none sm:col-span-1"
                value={x.note}
                placeholder="หมายเหตุ"
                aria-label="หมายเหตุห้อง"
                onChange={(e) => setM({ ...m, lecture: m.lecture.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)) })}
              />
              <RemoveButton label="ลบห้องนี้" onClick={() => setM({ ...m, lecture: m.lecture.filter((_, j) => j !== i) })} />
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-ghost mt-3" onClick={() => setM({ ...m, lecture: [...m.lecture, { _k: key(), name: "", note: "" }] })}>
          + เพิ่มห้อง
        </button>
      </div>
      <div className="card">
        <h2 className="mb-1 font-bold">สถานที่เรียนภาคปฏิบัติ</h2>
        <p className="mb-3 text-sm text-slate-500">
          ชื่อสนาม/อาคารใส่ครั้งเดียวในแถวแรก แถวถัดไปเว้นว่างได้ หมายเหตุแต่ละจุด เช่น “สนามที่ 1 สำหรับ กีฬามวยไทย” สนามที่มีจุดเดียวเขียน “ใช้สำหรับ กีฬาฟุตซอล”
          ห้องคอมพิวเตอร์เขียน “จำนวนคอมพิวเตอร์ 40 เครื่อง”
        </p>
        <ul className="space-y-3">
          {m.practice.map((x, i) => (
            <li key={x._k} className="grid grid-cols-[minmax(0,1fr)_2.5rem] gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_2.5rem]">
              <input
                className="input"
                value={x.place}
                placeholder={i > 0 ? "(สนามเดียวกับแถวบน)" : "ชื่อสนาม/อาคาร"}
                aria-label="ชื่อสนามหรืออาคาร"
                onChange={(e) => setM({ ...m, practice: m.practice.map((y, j) => (j === i ? { ...y, place: e.target.value } : y)) })}
              />
              <input
                className="input order-3 col-span-2 sm:order-none sm:col-span-1"
                value={x.note}
                placeholder="หมายเหตุ"
                aria-label="หมายเหตุสนาม"
                onChange={(e) => setM({ ...m, practice: m.practice.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)) })}
              />
              <RemoveButton label="ลบแถวนี้" onClick={() => setM({ ...m, practice: m.practice.filter((_, j) => j !== i) })} />
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-ghost mt-3" onClick={() => setM({ ...m, practice: [...m.practice, { _k: key(), place: "", note: "" }] })}>
          + เพิ่มแถว
        </button>
      </div>
    </div>
  );
}

export default function ManualEntryPage() {
  const source = useApi<Curriculum>("/api/curriculum");
  const settings = useApi<{ settings: Settings }>("/api/settings");
  const summary = useApi<Summary>("/api/data/summary");
  const [m, setModel] = useState<Model | null>(null);
  const [tab, setTab] = useState<string>("y1");
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ counts: Record<string, number>; warnings?: string[] } | null>(null);
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (source.data) setModel(fromApi(source.data));
  }, [source.data]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const setM = (next: Model) => {
    setModel(next);
    setDirty(true);
    setResult(null);
  };

  const lists = useMemo(() => {
    const teachers = new Set<string>();
    const places = new Set<string>();
    const cats = new Set<string>();
    const s = settings.data?.settings;
    for (const c of [...(s?.homeroom_categories ?? []), ...(s?.computer_categories ?? []), ...(s?.field_categories ?? [])]) cats.add(c);
    if (m) {
      for (const y of m.years)
        for (const g of y.groups)
          for (const r of g.rows) {
            r.teachers.split(",").forEach((t) => t.trim() && teachers.add(t.trim()));
            r.places.split(",").forEach((p) => p.trim() && places.add(p.trim()));
            if (r.category?.trim()) cats.add(r.category.trim());
          }
      m.admins.forEach((a) => a.name.trim() && teachers.add(a.name.trim()));
      m.lecture.forEach((x) => x.name.trim() && places.add(x.name.trim()));
      let building = "";
      for (const x of m.practice) {
        if (x.place.trim()) building = x.place.trim();
        if (!building) continue;
        const prefix = x.note.split("สำหรับ")[0].replace(/ใช้\s*$/, "").trim();
        places.add(prefix ? `${building} ${prefix}` : building);
      }
    }
    return { teachers: [...teachers].sort(), places: [...places], cats: [...cats] };
  }, [m, settings.data]);

  if (source.error) return <Alert tone="error">{source.error}</Alert>;
  if (!m) return <Spinner />;

  const hasData = (summary.data?.counts.sections ?? 0) > 0 || (summary.data?.counts.teachers ?? 0) > 0;
  const issues = problems(m);
  const yearTab = m.years.findIndex((y) => `y${y.year}` === tab);
  const rowCount = m.years.reduce((n, y) => n + y.groups.reduce((k, g) => k + g.rows.filter((r) => r.code.trim()).length, 0), 0);

  async function save() {
    if (!m) return;
    setSaving(true);
    setError("");
    try {
      const res = await api.post<{ counts: Record<string, number>; warnings?: string[] }>("/api/curriculum", toApi(m));
      setResult(res);
      setDirty(false);
      setConfirm(false);
      summary.reload();
      source.reload();
      toast.ok("บันทึกแล้ว");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const tabs: { id: string; label: string; count?: number }[] = [
    ...m.years.map((y) => ({ id: `y${y.year}`, label: `ชั้นปีที่ ${y.year}`, count: y.groups.length })),
    { id: "admins", label: "ฝ่ายบริหาร", count: m.admins.filter((a) => a.name.trim()).length },
    { id: "places", label: "สถานที่เรียน", count: m.lecture.length + m.practice.length },
  ];

  return (
    <div>
      <Stepper current={0} nextReady={hasData && !dirty} nextHint={dirty ? "บันทึกก่อน" : "กรอกข้อมูลก่อน"} />
      <PageHeader
        title="กรอกข้อมูล"
        subtitle="กรอกแบบเดียวกับไฟล์ Excel ข้อมูลหลักสูตร: ชั้นปี → กลุ่มเรียน → รายวิชา, ฝ่ายบริหาร และสถานที่เรียน"
        actions={
          <Link to="/import" className="btn btn-ghost">
            ← นำเข้าข้อมูล
          </Link>
        }
      />

      <div className="no-print mb-4 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 text-sm" role="tablist" aria-label="ส่วนของข้อมูล">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-9 cursor-pointer rounded-lg px-3 font-medium transition ${tab === t.id ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-800"}`}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1 text-xs text-slate-400 tabular-nums">({t.count})</span>}
          </button>
        ))}
        <button
          type="button"
          className="min-h-9 cursor-pointer rounded-lg px-3 font-medium text-brand-600 hover:text-brand-700"
          onClick={() => {
            const year = Math.max(0, ...m.years.map((y) => y.year)) + 1;
            setM({ ...m, years: [...m.years, { year, groups: [] }] });
            setTab(`y${year}`);
          }}
        >
          + ชั้นปี
        </button>
      </div>

      {yearTab >= 0 && (
        <YearPanel y={m.years[yearTab]} onChange={(y) => setM({ ...m, years: m.years.map((x, j) => (j === yearTab ? y : x)) })} />
      )}
      {tab === "admins" && <AdminsPanel m={m} setM={setM} />}
      {tab === "places" && <PlacesPanel m={m} setM={setM} />}

      <datalist id="mt-teachers">
        {lists.teachers.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id="mt-places">
        {lists.places.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <datalist id="mt-categories">
        {lists.cats.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="no-print sticky bottom-0 z-10 mt-6 -mx-4 border-t border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        {issues.length > 0 && (
          <details className="mb-2 text-sm text-amber-800">
            <summary className="cursor-pointer font-medium">ต้องแก้ก่อนบันทึก {issues.length} รายการ</summary>
            <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-5">
              {issues.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </details>
        )}
        {error && (
          <div className="mb-2">
            <Alert tone="error">
              <div className="font-semibold">บันทึกไม่สำเร็จ</div>
              <pre className="mt-1 max-h-40 overflow-y-auto font-sans whitespace-pre-wrap">{error}</pre>
            </Alert>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {hasData && dirty && (
            <label className="flex cursor-pointer items-start gap-2 text-sm text-amber-800">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-600" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              แทนที่ข้อมูลอาจารย์ กลุ่มเรียน ห้อง รายวิชา และการเปิดสอนเดิม (เวลาที่ไม่ว่างคงเดิม)
            </label>
          )}
          <span className="ml-auto flex items-center gap-2">
            {dirty ? <Badge tone="warn">ยังไม่บันทึก</Badge> : <span className="text-xs text-slate-400 tabular-nums">{rowCount} รายวิชา</span>}
            <button
              type="button"
              className="btn btn-primary"
              disabled={!dirty || saving || issues.length > 0 || rowCount === 0 || (hasData && !confirm)}
              onClick={save}
            >
              {saving ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          </span>
        </div>
      </div>

      {result && (
        <div className="mt-4 animate-[pop_.35s_ease-out] space-y-3">
          <Alert tone="ok">
            <div className="mb-1 font-semibold">บันทึกแล้ว</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {Object.entries(result.counts).map(([k, v]) => (
                <span key={k}>
                  {{ teachers: "อาจารย์", groups: "กลุ่มเรียน", rooms: "ห้อง/สนาม", courses: "รายวิชา", sections: "การเปิดสอน", admins: "ฝ่ายบริหาร" }[k] ?? k}{" "}
                  <span className="font-semibold tabular-nums">{v}</span>
                </span>
              ))}
            </div>
          </Alert>
          {result.warnings && result.warnings.length > 1 && (
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">สิ่งที่ระบบอ่านจากข้อมูล</div>
              <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto text-sm">
                {result.warnings.map((w, i) => (
                  <li key={i} className={`px-4 py-2 ${i === 0 ? "font-medium text-slate-800" : "text-slate-600"}`}>
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => navigate("/check")}>
            ตรวจข้อมูล <IconArrowRight />
          </button>
        </div>
      )}
      {toast.node}
    </div>
  );
}
