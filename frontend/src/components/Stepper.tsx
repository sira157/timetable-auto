import { Link } from "react-router-dom";
import { IconArrowRight } from "./Icons";

export const FLOW = [
  { to: "/import", label: "นำเข้า" },
  { to: "/check", label: "ตรวจข้อมูล" },
  { to: "/run", label: "คำนวณ" },
  { to: "/timetable", label: "ตรวจผล" },
  { to: "/reports", label: "ส่งออก" },
];

/** แถบขั้นตอนต่อเนื่อง: นำเข้า → ตรวจข้อมูล → คำนวณ → ตรวจผล → ส่งออก */
export default function Stepper({ current, nextReady = true, nextHint }: { current: number; nextReady?: boolean; nextHint?: string }) {
  const next = FLOW[current + 1];
  return (
    <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white px-3 py-2.5">
      <ol className="flex min-w-0 flex-1 items-center gap-1" aria-label="ขั้นตอนการทำงาน">
        {FLOW.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s.to} className="flex min-w-0 items-center gap-1">
              <Link
                to={s.to}
                aria-current={active ? "step" : undefined}
                className={`flex min-h-10 items-center gap-1.5 rounded-lg px-1.5 text-sm transition sm:px-2 ${
                  active ? "font-semibold text-indigo-700" : done ? "text-slate-600 hover:bg-slate-50" : "text-slate-400 hover:bg-slate-50"
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold transition ${
                    active ? "bg-indigo-600 text-white shadow-sm shadow-indigo-200" : done ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span className={`whitespace-nowrap ${active ? "inline" : "hidden xl:inline"}`}>{s.label}</span>
              </Link>
              {i < FLOW.length - 1 && <span className={`h-px w-3 shrink-0 sm:w-5 ${done ? "bg-green-300" : "bg-slate-200"}`} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
      {next && (
        <div className="flex items-center gap-2">
          {nextHint && !nextReady && <span className="hidden text-xs text-slate-400 sm:inline">{nextHint}</span>}
          <Link
            to={next.to}
            aria-disabled={!nextReady}
            className={`btn ${nextReady ? "btn-primary" : "btn-ghost pointer-events-none opacity-50"}`}
          >
            ถัดไป: {next.label} <IconArrowRight />
          </Link>
        </div>
      )}
    </div>
  );
}
