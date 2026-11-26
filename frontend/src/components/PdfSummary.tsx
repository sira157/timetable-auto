import type { Entry, Timetable } from "../lib/types";

interface Row {
  code: string;
  name: string;
  credits: string;
  teachers: string;
  groups: string;
  places: string;
  when: [number, number, number][]; // [วัน, คาบเริ่ม, คาบสุดท้าย]
  hours: number;
  note: string;
}

/** ตารางสรุปรายวิชาใต้ตารางสอนใน PDF (คอลัมน์เดียวกับไฟล์ข้อมูลหลักสูตร) */
export default function PdfSummary({ tt }: { tt: Timetable }) {
  const days = tt.days;
  const rows = new Map<string, Row>();
  const sorted = [...tt.entries].sort((a, b) => a.day - b.day || a.start - b.start);
  for (const e of sorted) {
    const key = tt.view === "group" ? e.course_code : `${e.course_code}|${e.group_label}`;
    const r = rows.get(key) ?? {
      code: e.course_code,
      name: e.course_name,
      credits: e.credits,
      teachers: e.teachers.join(", "),
      groups: e.group_label || e.groups.join(", "),
      places: "",
      when: [],
      hours: 0,
      note: noteOf(e),
    };
    const place = [e.room, e.field].filter(Boolean).join(" + ");
    if (place && !r.places.split(" / ").includes(place)) r.places = r.places ? `${r.places} / ${place}` : place;
    const last = r.when[r.when.length - 1];
    if (last && last[0] === e.day && last[2] + 1 === e.start) last[2] = e.start + e.length - 1;  // ทฤษฎี+ปฏิบัติต่อกัน รวมเป็นช่วงเดียว
    else r.when.push([e.day, e.start, e.start + e.length - 1]);
    r.hours += e.length;
    rows.set(key, r);
  }
  const list = [...rows.values()];
  const personCol = tt.view === "teacher" ? "ชั้นปี/กลุ่ม" : "อาจารย์ผู้สอน";
  const showGroups = tt.view === "room" || tt.view === "building";

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-base font-bold text-slate-800">รายวิชาในตาราง</h3>
        <span className="text-sm text-slate-500">
          {list.length} รายวิชา · {tt.total_hours} คาบ/สัปดาห์
        </span>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-slate-500">ไม่มีคาบเรียน</p>
      ) : (
        <table className="w-full border-collapse text-[13px] leading-snug">
          <thead>
            <tr className="bg-brand-50 text-left text-brand-900">
              {["ที่", "รหัสวิชา", "ชื่อรายวิชา", "หน่วยกิต", personCol, ...(showGroups ? ["กลุ่มเรียน"] : []), "สถานที่ที่ใช้", "วันและคาบ", "คาบ/สัปดาห์"].map(
                (h) => (
                  <th key={h} className="border border-slate-200 px-2 py-1.5 font-semibold">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={i} className={i % 2 ? "bg-slate-50" : ""}>
                <td className="border border-slate-200 px-2 py-1 text-center tabular-nums">{i + 1}</td>
                <td className="border border-slate-200 px-2 py-1 font-semibold whitespace-nowrap">{r.code}</td>
                <td className="border border-slate-200 px-2 py-1">
                  {r.name}
                  {r.note && <span className="text-slate-500"> ({r.note})</span>}
                </td>
                <td className="border border-slate-200 px-2 py-1 whitespace-nowrap tabular-nums">{r.credits}</td>
                <td className="border border-slate-200 px-2 py-1">{tt.view === "teacher" ? r.groups : r.teachers || "-"}</td>
                {showGroups && <td className="border border-slate-200 px-2 py-1">{r.groups}</td>}
                <td className="border border-slate-200 px-2 py-1">{r.places || "-"}</td>
                <td className="border border-slate-200 px-2 py-1">
                  {r.when.map(([d, a, b]) => `${days[d]} ${a === b ? a : `${a}–${b}`}`).join(", ")}
                </td>
                <td className="border border-slate-200 px-2 py-1 text-center tabular-nums">{r.hours}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-xs text-slate-400">
        {tt.version.name} · พิมพ์เมื่อ {new Date().toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}
      </p>
    </div>
  );
}

function noteOf(e: Entry) {
  const tags: string[] = [];
  if (e.kind === "elective") tags.push(e.elective_set ? `วิชาเลือก ${e.elective_set}` : "วิชาเลือก");
  if (e.kind === "free") tags.push("วิชาเลือกเสรี");
  if (e.kind === "combined") tags.push("เรียนรวม");
  if (e.coteach) tags.push("สอนร่วม");
  return tags.join(", ");
}
