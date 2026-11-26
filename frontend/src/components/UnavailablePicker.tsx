import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Busy, Settings, Teacher } from "../lib/types";
import { Alert, Badge, Spinner, useApi } from "./ui";

interface Detail {
  teacher: { id: number; name: string };
  slots: { day: number; period: number }[];
  others: { day: number; period: number; name: string }[];
  need_hours: number;
}

const key = (d: number, p: number) => `${d}-${p}`;
export const UNAVAILABLE_NAME = "ไม่สะดวกสอน";

/** เลือกช่วงเวลาที่อาจารย์ไม่สะดวกสอน: กดหรือลากบนตารางวัน x คาบ แล้วบันทึกเป็นเวลาที่ไม่ว่าง */
export default function UnavailablePicker({ settings, busy, teacherId, onTeacher, onSaved, onError }: {
  settings: Settings;
  busy: Busy[];
  teacherId: number | null;
  onTeacher: (id: number | null) => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const teachers = useApi<Teacher[]>("/api/data/teachers");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const paint = useRef<null | boolean>(null); // ระหว่างลาก: true = ทำเครื่องหมาย, false = ลบ
  const errRef = useRef(onError);
  errRef.current = onError;

  const lunch = useMemo(() => new Set(settings.lunch_periods), [settings.lunch_periods]);
  const teach = settings.periods.filter((p) => !lunch.has(p.no));
  const active = (teachers.data ?? []).filter((t) => !t.is_excluded);

  // จำนวนคาบไม่สะดวกของแต่ละคน แสดงในรายชื่อ
  const countOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of busy) {
      if (b.kind !== "unavailable" || b.name !== UNAVAILABLE_NAME || b.teacher_codes.length !== 1) continue;
      let n = 0;
      for (let p = b.start; p <= b.end; p++) if (!lunch.has(p)) n++;
      m.set(b.teacher_codes[0], (m.get(b.teacher_codes[0]) ?? 0) + n);
    }
    return m;
  }, [busy, lunch]);

  useEffect(() => {
    if (teacherId === null) return;
    let alive = true;
    setLoading(true);
    api
      .get<Detail>(`/api/teachers/${teacherId}/unavailable`)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setPicked(new Set(d.slots.map((s) => key(s.day, s.period))));
      })
      .catch((e) => errRef.current((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [teacherId]);

  useEffect(() => {
    const stop = () => (paint.current = null);
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);

  const others = useMemo(() => new Map((detail?.others ?? []).map((o) => [key(o.day, o.period), o.name])), [detail]);
  const saved = useMemo(() => new Set((detail?.slots ?? []).map((s) => key(s.day, s.period))), [detail]);
  const dirty = picked.size !== saved.size || [...picked].some((k) => !saved.has(k));
  const totalSlots = settings.days.length * teach.length;
  const blocked = new Set([...picked, ...others.keys()].filter((k) => !lunch.has(Number(k.split("-")[1]))));
  const free = totalSlots - blocked.size;
  const need = detail?.need_hours ?? 0;

  function set(d: number, p: number, on: boolean) {
    const k = key(d, p);
    if (others.has(k)) return;
    setPicked((prev) => {
      if (prev.has(k) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });
  }

  function toggleDay(d: number) {
    const cells = teach.filter((p) => !others.has(key(d, p.no)));
    const allOn = cells.every((p) => picked.has(key(d, p.no)));
    cells.forEach((p) => set(d, p.no, !allOn));
  }

  async function save() {
    if (teacherId === null) return;
    setSaving(true);
    try {
      const slots = [...picked].map((k) => {
        const [day, period] = k.split("-").map(Number);
        return { day, period };
      });
      await api.put(`/api/teachers/${teacherId}/unavailable`, { slots });
      setDetail((d) => (d ? { ...d, slots } : d));
      onSaved(`บันทึกแล้ว: ${detail?.teacher.name ?? ""} ไม่สะดวกสอน ${slots.length} คาบ`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card mb-5 border-brand-100 bg-gradient-to-br from-white to-brand-50/40">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-slate-800">อาจารย์ไม่สะดวกสอน</h2>
          <p className="text-sm text-slate-500">เลือกอาจารย์ แล้วกดหรือลากบนช่องที่ไม่สะดวกสอน ระบบจะไม่จัดสอนในช่องเหล่านี้</p>
        </div>
        <label className="block w-full sm:w-72">
          <span className="label">อาจารย์</span>
          <select
            className="input"
            value={teacherId ?? ""}
            onChange={(e) => {
              if (dirty && !window.confirm("ยังไม่ได้บันทึก ต้องการเปลี่ยนอาจารย์หรือไม่")) return;
              onTeacher(e.target.value ? Number(e.target.value) : null);
            }}
          >
            <option value="">— เลือกอาจารย์ —</option>
            {active.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {countOf.get(t.code) ? ` (ไม่สะดวก ${countOf.get(t.code)} คาบ)` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {teacherId === null ? (
        <p className="rounded-xl border border-dashed border-brand-200 bg-white/70 px-4 py-6 text-center text-sm text-slate-500">
          เลือกอาจารย์เพื่อกำหนดช่วงเวลาที่ไม่สะดวกสอน
        </p>
      ) : loading || !detail ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="warn">ไม่สะดวก {picked.size} คาบ</Badge>
            <Badge tone="ok">สอนได้ {free} คาบ</Badge>
            {need > 0 && <Badge tone="muted">ต้องสอนประมาณ {need} คาบ/สัปดาห์</Badge>}
            {dirty && <Badge tone="info">ยังไม่บันทึก</Badge>}
          </div>
          {need > free && (
            <div className="mb-3">
              <Alert tone="error">ช่องที่สอนได้เหลือน้อยกว่าคาบที่ต้องสอน ระบบจะจัดวิชาของอาจารย์คนนี้ไม่ครบ</Alert>
            </div>
          )}

          <div
            className="grid touch-none gap-1 select-none"
            style={{ gridTemplateColumns: `minmax(2.75rem, 4.75rem) repeat(${teach.length}, minmax(0, 1fr))` }}
            role="grid"
            aria-label={`ช่วงเวลาที่ ${detail.teacher.name} ไม่สะดวกสอน`}
          >
            <div />
            {teach.map((p) => (
              <div key={p.no} className="pb-1 text-center text-[11px] leading-tight text-slate-500">
                <div className="font-semibold text-slate-700">คาบ {p.no}</div>
                <div className="hidden tabular-nums sm:block">{p.start}</div>
              </div>
            ))}
            {settings.days.map((day, d) => (
              <div key={day} className="contents" role="row">
                <button
                  type="button"
                  className="min-w-0 truncate rounded-lg px-1 text-left text-xs font-semibold text-slate-700 hover:bg-brand-50 sm:text-sm"
                  title="กดเพื่อเลือก/ยกเลิกทั้งวัน"
                  onClick={() => toggleDay(d)}
                >
                  {day}
                </button>
                {teach.map((p) => {
                  const k = key(d, p.no);
                  const other = others.get(k);
                  const on = picked.has(k);
                  return (
                    <button
                      key={k}
                      type="button"
                      role="gridcell"
                      aria-pressed={on}
                      aria-label={`วัน${day} คาบ ${p.no}${other ? ` ${other}` : on ? " ไม่สะดวก" : " สอนได้"}`}
                      title={other ?? (on ? "ไม่สะดวกสอน" : "สอนได้")}
                      disabled={Boolean(other)}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        paint.current = !on;
                        set(d, p.no, !on);
                      }}
                      onPointerEnter={() => paint.current !== null && set(d, p.no, paint.current)}
                      onKeyDown={(e) => {
                        if (e.key === " " || e.key === "Enter") {
                          e.preventDefault();
                          set(d, p.no, !on);
                        }
                      }}
                      className={`h-10 min-w-0 truncate rounded-lg border px-0.5 text-[11px] font-medium transition sm:h-11 ${
                        other
                          ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500 [background-image:repeating-linear-gradient(45deg,transparent_0_5px,rgba(148,163,184,.18)_5px_10px)]"
                          : on
                            ? "border-amber-300 bg-amber-100 text-amber-800 shadow-inner"
                            : "border-brand-100 bg-white text-brand-700/70 hover:border-brand-300 hover:bg-brand-50"
                      }`}
                    >
                      <span className="hidden sm:inline">{other ? other : on ? "ไม่สะดวก" : ""}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="mr-auto flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded border border-brand-200 bg-white" /> สอนได้
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded border border-amber-300 bg-amber-100" /> ไม่สะดวก
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded border border-slate-200 bg-slate-100" /> ไม่ว่างจากรายการอื่น
              </span>
            </span>
            <button type="button" className="btn btn-ghost" disabled={!picked.size || saving} onClick={() => setPicked(new Set())}>
              ล้างทั้งหมด
            </button>
            <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>
              {saving ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
