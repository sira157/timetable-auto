import { useState, type ComponentType, type SVGProps } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { IconArrowDown, IconArrowRight, IconBolt, IconBook, IconBuilding, IconDoc, IconTable, IconUpload, IconUser, IconUsers } from "../components/Icons";
import { TimetableArt, WorkbookArt } from "../components/Illustrations";
import { Alert, Badge, Ring, Spinner, formatDateTime, useApi, useToast } from "../components/ui";
import { api, downloadFile } from "../lib/api";
import type { Summary } from "../lib/types";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

function StatCard({ label, value, icon: Ico, warn }: { label: string; value: number; icon: Icon; warn?: string }) {
  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <Ico />
        </span>
        <span className="text-sm text-slate-500">{label}</span>
      </div>
      <div className="text-3xl font-bold text-slate-800 tabular-nums">{value.toLocaleString("th-TH")}</div>
      {warn && <div className="rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">⚠ {warn}</div>}
    </div>
  );
}

const READINESS = [
  { key: "ready", label: "พร้อม", color: "bg-green-500" },
  { key: "review", label: "ต้องตรวจ", color: "bg-amber-400" },
  { key: "error", label: "ผิดพลาด", color: "bg-red-500" },
  { key: "missing", label: "ไม่พบในทะเบียน", color: "bg-violet-500" },
] as const;

function Readiness({ s }: { s: Summary }) {
  const total = READINESS.reduce((n, r) => n + (s.readiness[r.key] ?? 0), 0);
  return (
    <div className="card lg:col-span-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="font-bold">ความพร้อมของข้อมูล</h2>
        <Link to="/check" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
          ตรวจสอบ →
        </Link>
      </div>
      <p className="mb-4 text-sm text-slate-500">การเปิดสอน {total} รายการ</p>
      <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label="สัดส่วนความพร้อมของข้อมูล">
        {total > 0 &&
          READINESS.map((r) => {
            const n = s.readiness[r.key] ?? 0;
            return n ? <div key={r.key} className={r.color} style={{ width: `${(n / total) * 100}%` }} /> : null;
          })}
      </div>
      <ul className="space-y-2 text-sm">
        {READINESS.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-slate-600">
              <span className={`h-2.5 w-2.5 rounded-full ${r.color}`} aria-hidden="true" />
              {r.label}
            </span>
            <span className="font-semibold tabular-nums">{s.readiness[r.key] ?? 0}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CurrentSchedule({ s }: { s: Summary }) {
  const a = s.active;
  return (
    <div className="card lg:col-span-3">
      <h2 className="mb-1 font-bold">ตารางสอนปัจจุบัน</h2>
      {!a ? (
        <>
          <p className="mb-4 text-sm text-slate-500">ยังไม่ได้จัดตาราง</p>
          <Link to="/run" className="btn btn-primary">
            <IconBolt /> จัดตารางสอน
          </Link>
        </>
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-500">
            {a.name} · จัดเมื่อ {formatDateTime(a.created_at)}
          </p>
          <div className="mb-4 flex items-center gap-4">
          <Ring value={a.stats.placed_hours} total={a.stats.total_hours} />
          <div className="grid flex-1 grid-cols-3 gap-3">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">จัดได้</div>
              <div className="text-lg font-bold tabular-nums">
                {a.stats.placed_hours}/{a.stats.total_hours} <span className="text-xs font-normal text-slate-500">ชม.</span>
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">ข้อผิดพลาด</div>
              <div className={`text-lg font-bold tabular-nums ${a.errors ? "text-red-600" : "text-green-600"}`}>{a.errors}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">คำเตือน</div>
              <div className={`text-lg font-bold tabular-nums ${a.warnings ? "text-amber-600" : "text-green-600"}`}>{a.warnings}</div>
            </div>
          </div>
          </div>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {a.unplaced > 0 ? <Badge tone="error">จัดไม่ได้ {a.unplaced} รายการ</Badge> : <Badge tone="ok">จัดได้ครบทุกวิชา</Badge>}
            {a.relaxed_gap && <Badge tone="warn">ผ่อนเงื่อนไขคาบว่าง</Badge>}
            {a.data_changed && <Badge tone="warn">ข้อมูลเปลี่ยนหลังจัด</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/timetable" className="btn btn-primary">
              <IconTable /> ดูตารางสอน
            </Link>
            <Link to="/reports" className="btn btn-ghost">
              <IconDoc /> รายงาน
            </Link>
            <Link to="/run" className="btn btn-ghost">
              จัดใหม่
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

interface Step {
  title: string;
  desc: string;
  to: string;
  done: boolean;
}

function steps(s: Summary): Step[] {
  const imported = s.counts.sections > 0;
  const checked = imported && !s.readiness.error && !s.readiness.missing && s.data_errors === 0;
  const scheduled = Boolean(s.active);
  const reviewed = Boolean(s.active && s.active.errors === 0 && !s.active.data_changed && s.active.unplaced === 0);
  return [
    { title: "นำเข้า", desc: "Excel, CSV หรือ JSON", to: "/import", done: imported },
    { title: "ตรวจข้อมูล", desc: "แก้รายการสีแดงก่อนคำนวณ", to: "/check", done: checked },
    { title: "จัดตาราง", desc: "ระบบจัดให้อัตโนมัติ", to: "/run", done: scheduled },
    { title: "ตรวจผลและส่งออก", desc: "ลากปรับคาบ แล้วส่งออก", to: "/timetable", done: reviewed },
  ];
}

function GetStarted({ onSample }: { onSample: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <div>
      <div className="mb-5 flex flex-col items-center gap-5 rounded-2xl border border-slate-200/80 bg-white p-5 md:flex-row">
        <WorkbookArt className="w-full max-w-sm shrink-0" />
        <div>
          <h2 className="text-lg font-bold">เริ่มต้นใช้งาน — เลือกวิธีใส่ข้อมูล</h2>
          <p className="mt-1 text-sm text-slate-500">
            ใช้ไฟล์ Excel ข้อมูลหลักสูตร (ชีต ชั้นปีที่ 1–4, ฝ่ายบริหาร, สถานที่เรียน) ดาวน์โหลดแบบฟอร์ม กรอกข้อมูล แล้วนำเข้า
          </p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="card flex flex-col">
          <div className="mb-2 text-2xl" aria-hidden="true">
            📄
          </div>
          <h3 className="font-semibold">ดาวน์โหลดแบบฟอร์ม</h3>
          <p className="mb-4 flex-1 text-sm text-slate-500">แบบฟอร์ม Excel พร้อมคำอธิบายแต่ละคอลัมน์</p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => downloadFile("/api/export/template.xlsx", "แบบฟอร์มข้อมูลตารางสอน.xlsx").catch((e) => toast.error(e.message))}
          >
            <IconArrowDown /> ดาวน์โหลด
          </button>
        </div>
        <div className="card flex flex-col">
          <div className="mb-2 text-2xl" aria-hidden="true">
            📥
          </div>
          <h3 className="font-semibold">นำเข้าไฟล์</h3>
          <p className="mb-4 flex-1 text-sm text-slate-500">อัปโหลดไฟล์ Excel (.xlsx) หรือ JSON ที่กรอกข้อมูลแล้ว</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate("/import")}>
            <IconUpload /> นำเข้าไฟล์
          </button>
        </div>
        <div className="card flex flex-col">
          <div className="mb-2 text-2xl" aria-hidden="true">
            ⌨️
          </div>
          <h3 className="font-semibold">กรอกบนเว็บ</h3>
          <p className="mb-4 flex-1 text-sm text-slate-500">เพิ่มอาจารย์ รายวิชา กลุ่มเรียน และการเปิดสอนทีละรายการ</p>
          <button type="button" className="btn btn-ghost" onClick={() => navigate("/import/manual")}>
            กรอกข้อมูลเอง
          </button>
        </div>
      </div>
      <button type="button" onClick={onSample} className="mt-4 cursor-pointer text-sm font-medium text-indigo-600 hover:text-indigo-700">
        ลองนำเข้าข้อมูลตัวอย่าง →
      </button>
      {toast.node}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: s, loading, error, reload } = useApi<Summary>("/api/data/summary");
  const toast = useToast();
  const [importing, setImporting] = useState(false);

  async function importSample() {
    setImporting(true);
    try {
      await api.post("/api/import/sample");
      toast.ok("นำเข้าข้อมูลตัวอย่างแล้ว");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  if (loading && !s) return <Spinner />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!s) return null;

  const st = steps(s);
  const nextIdx = st.findIndex((x) => !x.done);
  const next = nextIdx >= 0 ? st[nextIdx] : null;
  const empty = s.counts.sections === 0 && s.counts.teachers === 0 && s.counts.courses === 0;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 p-6 text-white shadow-sm sm:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-indigo-100">{user?.display_name ? `สวัสดี ${user.display_name}` : "ยินดีต้อนรับ"}</p>
            <h1 className="mt-1 text-2xl font-bold lg:text-3xl">ระบบจัดตารางสอนอัตโนมัติ</h1>
            <p className="mt-2 max-w-xl text-sm text-indigo-100">
              นำเข้าข้อมูล → กดคำนวณ → ตรวจผลและลากปรับ → ส่งออก PDF / Excel / CSV
            </p>
          </div>
          <TimetableArt className="hidden w-64 shrink-0 -rotate-2 drop-shadow-xl xl:block" />
          <div className="w-full shrink-0 rounded-xl bg-white/10 p-4 backdrop-blur md:w-64">
            <div className="text-xs text-indigo-100">ขั้นตอนถัดไป</div>
            <div className="mt-0.5 mb-3 font-semibold">{next ? next.title : "เรียบร้อยทุกขั้นตอน"}</div>
            <button
              type="button"
              className="btn w-full bg-white font-bold text-indigo-700 hover:bg-indigo-50"
              onClick={() => navigate(next ? next.to : "/timetable")}
            >
              {next ? "ไปที่ขั้นตอนนี้" : "ดูตารางสอน"} <IconArrowRight />
            </button>
          </div>
        </div>
      </section>

      {s.settings_problems.length > 0 && (
        <Alert tone="error" onClick={() => navigate("/system/settings")}>
          <span className="font-semibold">การตั้งค่าเวลาไม่ถูกต้อง:</span> {s.settings_problems.join(", ")} — กดเพื่อแก้ไข
        </Alert>
      )}
      {s.active?.data_changed && (
        <Alert tone="warn" onClick={() => navigate("/run")}>
          <span className="font-semibold">ข้อมูลเปลี่ยนหลังจัดตาราง</span> ตาราง “{s.active.name}” อาจไม่ตรงกับข้อมูลล่าสุด — กดเพื่อจัดตารางใหม่
        </Alert>
      )}

      {empty ? (
        <GetStarted onSample={importing ? () => undefined : importSample} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="อาจารย์" value={s.counts.teachers} icon={IconUser} />
            <StatCard label="รายวิชา" value={s.counts.courses} icon={IconBook} />
            <StatCard label="กลุ่มเรียน" value={s.counts.groups} icon={IconUsers} />
            <StatCard label="ห้องเรียน" value={s.counts.rooms} icon={IconBuilding} warn={s.counts.rooms === 0 ? "ยังไม่มีห้องเรียน" : undefined} />
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <CurrentSchedule s={s} />
            <Readiness s={s} />
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {st.map((x, i) => {
              const isNext = i === nextIdx;
              return (
                <Link
                  key={x.title}
                  to={x.to}
                  className={`card flex flex-col gap-2 transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md ${isNext ? "border-indigo-300 ring-4 ring-indigo-100" : ""}`}
                >
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                      x.done ? "bg-green-100 text-green-700" : isNext ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {x.done ? "✓" : i + 1}
                  </span>
                  <span className="font-semibold text-slate-800">{x.title}</span>
                  <span className="text-xs text-slate-500">{x.desc}</span>
                  <span className="mt-auto text-xs">{x.done ? <Badge tone="ok">เสร็จแล้ว</Badge> : isNext ? <Badge tone="info">ถัดไป</Badge> : null}</span>
                </Link>
              );
            })}
          </div>

          <div>
            <h2 className="mb-3 font-bold">ทางลัด</h2>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[
                { emoji: "👩‍🏫", title: "ตารางสอนอาจารย์", desc: "ดูตารางรายบุคคล", to: "/timetable?view=teacher" },
                { emoji: "👥", title: "ตารางเรียนชั้นปี", desc: "ดูตารางของแต่ละชั้นปี/กลุ่ม", to: "/timetable?view=group" },
                { emoji: "🏫", title: "การใช้ห้องและสนาม", desc: "ดูตารางของห้องและจุดสนาม", to: "/timetable?view=room" },
                { emoji: "🔐", title: "บัญชีผู้ใช้", desc: "สร้างบัญชีให้อาจารย์และนักเรียน", to: "/system/users" },
              ].map((x) => (
                <Link key={x.title} to={x.to} className="card flex flex-col gap-1 transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md">
                  <span className="text-2xl" aria-hidden="true">
                    {x.emoji}
                  </span>
                  <span className="font-semibold text-slate-800">{x.title}</span>
                  <span className="text-xs text-slate-500">{x.desc}</span>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
      {toast.node}
    </div>
  );
}
