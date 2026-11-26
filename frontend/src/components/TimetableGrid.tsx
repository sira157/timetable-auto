import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { Entry, MoveSlot, Timetable, TimetableEvent, View } from "../lib/types";
import { IconLock } from "./Icons";

type Item =
  | { type: "entry"; entry: Entry; start: number; length: number }
  | { type: "electives"; list: Entry[]; start: number; length: number }
  | { type: "event"; event: TimetableEvent; start: number; length: number };

/** มุมมองชั้นปี: วิชาเลือกที่เรียนเวลาเดียวกันรวมเป็นกล่องเดียว */
function groupElectives(entries: Entry[], view: View): (Entry | Entry[])[] {
  if (view !== "group") return entries;
  const out: (Entry | Entry[])[] = [];
  const boxes = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.kind === "elective" || e.kind === "free") {
      const box = boxes.get(e.unit_key);
      if (box) box.push(e);
      else {
        const nb = [e];
        boxes.set(e.unit_key, nb);
        out.push(nb);
      }
    } else out.push(e);
  }
  return out;
}

const KIND_STYLE: Record<string, string> = {
  normal: "bg-sky-50 border-sky-200 text-sky-900",
  elective: "bg-sky-50 border-sky-200 text-sky-900",
  free: "bg-sky-50 border-sky-200 text-sky-900",
  combined: "bg-green-50 border-green-200 text-green-900",
  coteach: "bg-indigo-50 border-indigo-200 text-indigo-900",
  activity: "bg-violet-50 border-violet-200 text-violet-800",
  meeting: "bg-slate-100 border-slate-300 text-slate-700",
  lunch: "bg-amber-50 border-amber-200 text-amber-800",
};

export const LEGEND: { key: string; label: string }[] = [
  { key: "normal", label: "วิชาปกติ" },
  { key: "combined", label: "เรียนรวม" },
  { key: "coteach", label: "สอนร่วม" },
  { key: "activity", label: "กิจกรรม" },
  { key: "meeting", label: "ประชุม" },
  { key: "lunch", label: "พักกลางวัน" },
];

/** การลากวาง: ช่องที่วางได้จะเป็นสีเขียว */
export interface DragSupport {
  dragging: Entry | null;
  slots: Map<string, MoveSlot> | null;
  onDragStart: (e: Entry) => void;
  onDragEnd: () => void;
  onDrop: (day: number, start: number) => void;
}

function entryStyle(e: Entry) {
  if (e.kind === "combined") return KIND_STYLE.combined;
  if (e.coteach || e.kind === "coteach") return KIND_STYLE.coteach;
  return KIND_STYLE[e.kind] ?? KIND_STYLE.normal;
}

function Tag({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`shrink-0 rounded px-1 py-px text-[10px] leading-4 font-medium text-white ${className}`}>{children}</span>;
}

/** แยกช่วงที่ทับเวลาพักออก เพื่อไม่ให้บล็อกคร่อมคอลัมน์พักกลางวัน */
function segments(start: number, length: number, lunch: Set<number>): { start: number; length: number }[] {
  const out: { start: number; length: number }[] = [];
  let cur: { start: number; length: number } | null = null;
  for (let p = start; p < start + length; p++) {
    if (lunch.has(p)) {
      cur = null;
      continue;
    }
    if (cur) cur.length++;
    else {
      cur = { start: p, length: 1 };
      out.push(cur);
    }
  }
  return out;
}

function buildLanes(items: Item[]): Item[][] {
  const lanes: Item[][] = [];
  const sorted = [...items].sort((a, b) => a.start - b.start || b.length - a.length);
  for (const it of sorted) {
    const lane = lanes.find((l) => {
      const last = l[l.length - 1];
      return last.start + last.length <= it.start;
    });
    if (lane) lane.push(it);
    else lanes.push([it]);
  }
  return lanes.length ? lanes : [[]];
}

/** ข้อความ 4 บรรทัดตามข้อ 14 ของกฎ */
export function entryLines(e: Entry, view: View) {
  const place = [e.room, e.field].filter(Boolean).join(" + ") || "ยังไม่มีห้อง";
  const teachers = e.teachers.join(", ") || "ยังไม่มีผู้สอน";
  const group = e.group_label || e.groups.join(", ");
  if (view === "teacher") {
    return { third: e.co_teachers.length ? `${group} · ร่วมกับ ${e.co_teachers.join(", ")}` : group, fourth: place };
  }
  if (view === "room") return { third: teachers, fourth: group };
  if (view === "building") return { third: teachers, fourth: `${place} · ${group}` };
  return { third: teachers, fourth: place };
}

function matches(e: Entry, q: string) {
  if (!q) return true;
  const text = `${e.course_code} ${e.course_name} ${e.teachers.join(" ")} ${e.groups.join(" ")} ${e.room ?? ""} ${e.field ?? ""}`.toLowerCase();
  return text.includes(q.toLowerCase());
}

function EntryBlock({ e, view, onSelect, drag, dim }: { e: Entry; view: View; onSelect?: (e: Entry) => void; drag?: DragSupport; dim: boolean }) {
  const { third, fourth } = entryLines(e, view);
  const isDragging = Boolean(drag?.dragging && drag.dragging.unit_key === e.unit_key);
  const title = [
    `${e.course_code} ${e.course_name} ${e.credits}`,
    `ผู้สอน: ${e.teachers.join(", ") || "-"}`,
    `กลุ่มเรียน: ${e.group_label || e.groups.join(", ")}`,
    `สถานที่: ${[e.room, e.field].filter(Boolean).join(" + ") || "-"}`,
    e.locked ? "ล็อกไว้" : drag ? "ลากเพื่อย้าย หรือกดเพื่อดูรายละเอียด" : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <button
      type="button"
      title={title}
      draggable={Boolean(drag) && !e.locked}
      onDragStart={(ev) => {
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData("text/plain", String(e.id));
        drag?.onDragStart(e);
      }}
      onDragEnd={() => drag?.onDragEnd()}
      onClick={() => onSelect?.(e)}
      className={`flex h-full min-h-16 w-full flex-col gap-0.5 overflow-hidden rounded-md border px-1.5 py-1 text-left text-xs leading-snug transition ${entryStyle(e)} ${
        onSelect ? "cursor-pointer hover:-translate-y-px hover:shadow-md" : "cursor-default"
      } ${isDragging ? "opacity-40" : ""} ${dim ? "opacity-25" : ""}`}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
        <span className="font-bold whitespace-nowrap">{e.course_code}</span>
        <span className="min-w-0 truncate text-[10px] opacity-70">{e.credits}</span>
        {e.kind === "combined" && <Tag className="bg-green-700">เรียนรวม</Tag>}
        {e.coteach && <Tag className="bg-indigo-700">สอนร่วม</Tag>}
        {e.kind === "elective" && <Tag className="bg-sky-700">วิชาเลือก</Tag>}
        {e.kind === "free" && <Tag className="bg-sky-700">เลือกเสรี</Tag>}
        {e.locked && <IconLock width={12} height={12} className="ml-auto shrink-0 opacity-70" aria-label="ล็อกไว้" />}
      </span>
      <span className="line-clamp-2">
        {e.course_name}
      </span>
      <span className={view === "teacher" && e.coteach ? "line-clamp-2 opacity-80" : "truncate opacity-80"}>{third}</span>
      <span className="truncate opacity-80">{fourth}</span>
    </button>
  );
}

function ElectiveBlock({ list, onSelect, drag, dim }: { list: Entry[]; onSelect?: (e: Entry) => void; drag?: DragSupport; dim: boolean }) {
  const first = list[0];
  const label = first.kind === "free" ? "วิชาเลือกเสรี" : "วิชาเลือก";
  const isDragging = Boolean(drag?.dragging && drag.dragging.unit_key === first.unit_key);
  return (
    <button
      type="button"
      title={`${label} ${first.elective_set}\nลากเพื่อย้ายทั้งกลุ่ม หรือกดเพื่อดูรายละเอียด`}
      draggable={Boolean(drag) && !first.locked}
      onDragStart={(ev) => {
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData("text/plain", String(first.id));
        drag?.onDragStart(first);
      }}
      onDragEnd={() => drag?.onDragEnd()}
      onClick={() => onSelect?.(first)}
      className={`flex h-full min-h-16 w-full flex-col gap-1 rounded-md border px-1.5 py-1 text-left text-xs leading-snug transition ${KIND_STYLE.elective} ${
        onSelect ? "cursor-pointer hover:-translate-y-px hover:shadow-md" : "cursor-default"
      } ${isDragging ? "opacity-40" : ""} ${dim ? "opacity-25" : ""}`}
    >
      <span className="flex min-w-0 items-center gap-1">
        <Tag className="bg-sky-700">{label}</Tag>
        <span className="min-w-0 truncate font-bold">{first.elective_set}</span>
        <span className="shrink-0 text-[10px] opacity-70">{first.credits}</span>
        {first.locked && <IconLock width={12} height={12} className="ml-auto shrink-0 opacity-70" aria-label="ล็อกไว้" />}
      </span>
      <span className="text-[11px] opacity-75">เลือกเรียน 1 จาก {list.length} วิชา</span>
      <span className="flex flex-col gap-0.5 border-t border-sky-200/80 pt-1">
        {list.map((e) => (
          <span key={e.id} className="block leading-tight">
            <span className="font-semibold">{e.course_code}</span> {e.course_name}
            <span className="block truncate text-[11px] opacity-75">
              {e.teachers.join(", ") || "ยังไม่มีผู้สอน"} · {[e.room, e.field].filter(Boolean).join(" + ") || "-"}
            </span>
          </span>
        ))}
      </span>
    </button>
  );
}

function EventBlock({ ev }: { ev: TimetableEvent }) {
  return (
    <div className={`flex h-full min-h-16 w-full items-center justify-center rounded-md border px-1.5 py-1 text-center text-xs font-medium ${KIND_STYLE[ev.kind]}`}>
      {ev.name}
    </div>
  );
}

export function Legend({ hasLunch }: { hasLunch: boolean }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
      {LEGEND.map((l) => (
        <span key={l.key} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-3 w-5 rounded-sm border ${KIND_STYLE[l.key]}`} aria-hidden="true" />
          {l.label}
        </span>
      ))}
      {!hasLunch && <span className="text-slate-400">ช่องว่างช่วงกลางวัน = เวลาพัก</span>}
    </div>
  );
}

interface Props {
  tt: Timetable;
  onSelect?: (e: Entry) => void;
  actions?: ReactNode;
  drag?: DragSupport;
  search?: string;
  /** แสดงแบบตารางเสมอ (ใช้ตอนสร้าง PDF) */
  forceGrid?: boolean;
}

/** มือถือ: แสดงเป็นรายวัน เรียงคาบจากเช้าถึงเย็น ไม่ต้องเลื่อนแนวนอน */
function DayList({ tt, onSelect, search }: { tt: Timetable; onSelect?: (e: Entry) => void; search: string }) {
  const periods = new Map(tt.periods.map((p) => [p.no, p]));
  const lunchStart = Math.min(...tt.lunch_periods, 99);
  const time = (s: number, l: number) => `${periods.get(s)?.start ?? ""}–${periods.get(s + l - 1)?.end ?? ""}`;
  const label = (s: number, l: number) => (l > 1 ? `คาบ ${s}–${s + l - 1}` : `คาบ ${s}`);
  return (
    <div className="space-y-3">
      {tt.days.map((day, d) => {
        const rows: { start: number; length: number; node: ReactNode }[] = [];
        for (const x of groupElectives(tt.entries.filter((e) => e.day === d), tt.view)) {
          if (Array.isArray(x)) {
            const len = Math.max(...x.map((m) => m.length));
            rows.push({ start: x[0].start, length: len, node: <ElectiveBlock list={x} onSelect={onSelect} dim={!x.some((e) => matches(e, search))} /> });
          } else {
            rows.push({ start: x.start, length: x.length, node: <EntryBlock e={x} view={tt.view} onSelect={onSelect} dim={!matches(x, search)} /> });
          }
        }
        for (const ev of tt.events.filter((x) => x.day === d)) rows.push({ start: ev.start, length: ev.length, node: <EventBlock ev={ev} /> });
        rows.sort((a, b) => a.start - b.start);
        const morning = rows.filter((r) => r.start < lunchStart);
        const afternoon = rows.filter((r) => r.start >= lunchStart);
        const renderRow = (r: (typeof rows)[number], i: number) => (
          <li key={i} className="grid grid-cols-[4.5rem_1fr] gap-2">
            <div className="pt-1 text-xs leading-tight text-slate-500">
              <div className="font-semibold text-slate-700">{label(r.start, r.length)}</div>
              <div className="tabular-nums">{time(r.start, r.length)}</div>
            </div>
            <div className="min-w-0">{r.node}</div>
          </li>
        );
        return (
          <section key={day} className="rounded-xl border border-slate-200 bg-white">
            <h3 className="flex items-center justify-between border-b border-slate-100 px-3 py-2 font-semibold text-slate-800">
              วัน{day}
              <span className="text-xs font-normal text-slate-400">{rows.length ? `${rows.length} รายการ` : "ไม่มีคาบเรียน"}</span>
            </h3>
            {rows.length > 0 && (
              <ul className="space-y-2 p-3">
                {morning.map(renderRow)}
                {tt.lunch_periods.length > 0 && morning.length > 0 && afternoon.length > 0 && (
                  <li className={`rounded-md border py-1 text-center text-xs font-medium ${KIND_STYLE.lunch}`}>พักกลางวัน</li>
                )}
                {afternoon.map(renderRow)}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default function TimetableGrid({ tt, onSelect, actions, drag, search = "", forceGrid = false }: Props) {
  const box = useRef<HTMLElement>(null);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  async function toggleFull() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await box.current?.requestFullscreen();
    } catch {
      /* เบราว์เซอร์ไม่รองรับเต็มจอ */
    }
  }
  const lunch = new Set(tt.lunch_periods);
  const periods = tt.periods;
  const N = periods.length;
  const [hover, setHover] = useState<string | null>(null);
  const dragLen = drag?.dragging ? Math.max(drag.dragging.length, 1) : 1;

  const slotAt = (d: number, p: number) => drag?.slots?.get(`${d}-${p}`);
  const anyOk = (d: number, from: number, span: number) => {
    for (let p = from; p < from + span; p++) if (slotAt(d, p)?.ok) return true;
    return false;
  };

  function periodFromEvent(ev: DragEvent<HTMLTableCellElement>, from: number, span: number) {
    const rect = ev.currentTarget.getBoundingClientRect();
    const idx = Math.min(span - 1, Math.max(0, Math.floor(((ev.clientX - rect.left) / rect.width) * span)));
    return from + idx;
  }

  function dropProps(d: number, from: number, span: number) {
    if (!drag?.dragging) return {};
    return {
      onDragOver: (ev: DragEvent<HTMLTableCellElement>) => {
        const p = periodFromEvent(ev, from, span);
        if (slotAt(d, p)?.ok) {
          ev.preventDefault();
          ev.dataTransfer.dropEffect = "move";
          setHover(`${d}-${p}`);
        } else setHover(null);
      },
      onDragLeave: () => setHover(null),
      onDrop: (ev: DragEvent<HTMLTableCellElement>) => {
        ev.preventDefault();
        const p = periodFromEvent(ev, from, span);
        setHover(null);
        if (slotAt(d, p)?.ok) drag.onDrop(d, p);
      },
    };
  }

  /** สีช่องระหว่างลาก: เขียว = วางได้, เขียวเข้ม = ตำแหน่งที่จะวาง */
  function dropClass(d: number, from: number, span: number) {
    if (!drag?.dragging || !drag.slots) return "";
    if (hover) {
      const [hd, hp] = hover.split("-").map(Number);
      if (hd === d && from < hp + dragLen && from + span > hp) return "bg-green-200/80 outline-2 -outline-offset-2 outline-green-500";
    }
    return anyOk(d, from, span) ? "bg-green-50 outline-1 -outline-offset-2 outline-dashed outline-green-400" : "bg-slate-50/70";
  }

  // ตอนสร้าง PDF ห้ามใช้ sticky: ตารางถูกวาดนอกจอ html2canvas จะวางคอลัมน์วันผิดตำแหน่ง
  const stick = forceGrid ? "" : "sticky";
  const okCount = drag?.slots ? [...drag.slots.values()].filter((s) => s.ok && !s.current).length : 0;

  const dayLanes = tt.days.map((_day, d) => {
    const items: Item[] = [];
    for (const x of groupElectives(tt.entries.filter((e) => e.day === d), tt.view)) {
      const e = Array.isArray(x) ? x[0] : x;
      const length = Array.isArray(x) ? Math.max(...x.map((m) => m.length)) : e.length;
      for (const seg of segments(e.start, length, lunch)) {
        items.push(Array.isArray(x) ? { type: "electives", list: x, ...seg } : { type: "entry", entry: e, ...seg });
      }
    }
    for (const ev of tt.events.filter((x) => x.day === d)) {
      for (const seg of segments(ev.start, ev.length, lunch)) items.push({ type: "event", event: ev, ...seg });
    }
    return buildLanes(items);
  });
  const totalRows = dayLanes.reduce((n, l) => n + l.length, 0);

  return (
    <section
      ref={box}
      className="card print-full tt-full"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-bold text-slate-800">{tt.title}</h2>
          <p className="text-sm text-slate-500">{tt.subtitle}</p>
          {tt.notices.map((n, i) => (
            <div key={i} className="mt-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800">
              <div className="font-semibold">{n.text}</div>
              {n.teachers && n.teachers.length > 0 && <div>อาจารย์ผู้รับผิดชอบ: {n.teachers.join(", ")}</div>}
              {n.advisor && <div>อาจารย์ที่ปรึกษา: {n.advisor}</div>}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {actions}
          <span className="text-xs whitespace-nowrap text-slate-500 tabular-nums">{tt.total_hours} คาบ/สัปดาห์</span>
          {!forceGrid && (
            <button type="button" className="no-print btn btn-ghost hidden px-3 md:inline-flex" onClick={toggleFull} title="ดูตารางเต็มหน้าจอ">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                {full ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
              </svg>
              {full ? "ออกจากเต็มจอ" : "เต็มจอ"}
            </button>
          )}
        </div>
      </div>

      {drag?.dragging && (
        <div className="no-print mb-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800" role="status">
          {drag.slots ? `วางได้ ${okCount} ช่อง (สีเขียว) · ปล่อยนอกตารางเพื่อยกเลิก` : "กำลังตรวจช่องที่วางได้…"}
        </div>
      )}

      {!forceGrid && (
        <div className="no-print md:hidden">
          <DayList tt={tt} onSelect={onSelect} search={search} />
        </div>
      )}
      <div className={`print-full ${forceGrid ? "" : "hidden md:block print:block"}`}>
        <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
          <colgroup>
            <col className="w-16" />
            {periods.map((p) => (
              <col key={p.no} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className={`${stick} top-0 left-0 z-20 border-b border-slate-200 bg-slate-50 px-2 py-2 text-left text-xs font-semibold text-slate-500`}>
                วัน / คาบ
              </th>
              {periods.map((p) => (
                <th key={p.no} className={`${stick} top-0 z-10 border-b border-l border-slate-200 border-l-slate-100 bg-slate-50 px-1 py-1.5 text-center`}>
                  <div className="text-xs font-semibold text-slate-600">คาบ {p.no}</div>
                  <div className="text-[11px] font-normal text-slate-400 tabular-nums">
                    {p.start}–{p.end}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dayLanes.map((lanes, d) => {
              const day = tt.days[d];
              return lanes.map((lane, li) => {
                const cells: ReactNode[] = [];
                const lastLane = li === lanes.length - 1;
                const border = lastLane ? "border-b border-slate-200" : "";
                let p = 1;
                while (p <= N) {
                  if (lunch.has(p)) {
                    // พักกลางวัน: แถบเดียวตลอดทุกวัน มีคำเดียว
                    if (d === 0 && li === 0) {
                      cells.push(
                        <td key={`l${p}`} rowSpan={totalRows} className="h-px border-b border-l border-slate-200 border-l-slate-100 p-1">
                          <div className={`flex h-full items-center justify-center rounded-md border text-xs font-semibold whitespace-nowrap ${KIND_STYLE.lunch}`}>
                            พักกลางวัน
                          </div>
                        </td>,
                      );
                    }
                    p++;
                    continue;
                  }
                  const it = lane.find((x) => x.start === p);
                  if (it) {
                    cells.push(
                      <td
                        key={p}
                        colSpan={it.length}
                        className={`h-px border-l border-slate-100 p-1 align-top transition-colors ${border} ${dropClass(d, p, it.length)}`}
                        {...dropProps(d, p, it.length)}
                      >
                        {it.type === "entry" ? (
                          <EntryBlock e={it.entry} view={tt.view} onSelect={onSelect} drag={drag} dim={!matches(it.entry, search)} />
                        ) : it.type === "electives" ? (
                          <ElectiveBlock list={it.list} onSelect={onSelect} drag={drag} dim={!it.list.some((e) => matches(e, search))} />
                        ) : (
                          <EventBlock ev={it.event} />
                        )}
                      </td>,
                    );
                    p += it.length;
                  } else {
                    cells.push(
                      <td key={p} className={`h-[72px] border-l border-slate-100 p-1 transition-colors ${border} ${dropClass(d, p, 1)}`} {...dropProps(d, p, 1)} />,
                    );
                    p++;
                  }
                }
                return (
                  <tr key={`${d}-${li}`}>
                    {li === 0 && (
                      <th
                        scope="row"
                        rowSpan={lanes.length}
                        className={`${stick} left-0 z-10 border-b border-slate-200 bg-white px-2 py-2 text-left align-top font-semibold text-slate-800`}
                      >
                        {day}
                      </th>
                    )}
                    {cells}
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
      <Legend hasLunch={lunch.size > 0} />
    </section>
  );
}
