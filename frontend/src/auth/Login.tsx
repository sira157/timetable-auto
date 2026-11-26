import { useState, type FormEvent, type ReactNode } from "react";
import { LogoMark } from "../components/Illustrations";
import { useAuth } from "./AuthContext";

// บล็อกวิชาในตารางตัวอย่างบนหน้าเข้าสู่ระบบ [วัน, คาบเริ่ม, จำนวนคาบ, สี] (ภาพประกอบ ไม่ใช่ข้อมูลจริง)
const DAYS = ["จ", "อ", "พ", "พฤ", "ศ"];
const LUNCH = 5;
const BLOCKS: [number, number, number, string][] = [
  [0, 1, 2, "bg-brand-200"], [0, 6, 3, "bg-sun-200"],
  [1, 2, 3, "bg-sky-200"], [1, 7, 2, "bg-brand-300"],
  [2, 1, 3, "bg-sun-300"], [2, 6, 2, "bg-brand-200"],
  [3, 3, 2, "bg-brand-300"], [3, 7, 3, "bg-sky-200"],
  [4, 1, 2, "bg-sky-200"], [4, 3, 2, "bg-sun-200"], [4, 6, 2, "bg-brand-200"],
];

/** ตารางสอนจำลองที่บล็อกวิชาค่อย ๆ ตกลงช่องเอง วนซ้ำ */
function LiveTimetable() {
  return (
    <div className="relative rounded-3xl border border-white/25 bg-white/10 p-4 shadow-2xl shadow-brand-950/30 backdrop-blur-md" aria-hidden="true">
      <div className="mb-3 flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-sun-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-brand-300" />
        <span className="ml-auto rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium text-brand-50">กำลังจัดตาราง…</span>
      </div>
      <div className="grid grid-cols-[1.75rem_repeat(9,minmax(0,1fr))] gap-1 text-[10px]">
        <div />
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="text-center text-brand-100/80">
            {i + 1}
          </div>
        ))}
        {DAYS.map((d, di) => (
          <div key={d} className="contents">
            <div className="flex h-8 items-center text-xs font-semibold text-brand-50">{d}</div>
            <div className="relative col-span-9 grid h-8 grid-cols-9 gap-1">
              {Array.from({ length: 9 }, (_, i) => (
                <div key={i} className={`rounded-md ${i + 1 === LUNCH ? "bg-sun-200/25" : "bg-white/8 ring-1 ring-white/10 ring-inset"}`} />
              ))}
              {BLOCKS.filter((b) => b[0] === di).map(([, start, len, color], bi) => (
                <div
                  key={bi}
                  className={`slot-in absolute inset-y-0 rounded-md ${color} shadow-sm`}
                  style={{
                    left: `calc(${((start - 1) / 9) * 100}% + 1px)`,
                    width: `calc(${(len / 9) * 100}% - 4px)`,
                    animationDelay: `${(di * 3 + bi) * 0.28}s`,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="bob absolute -right-4 -bottom-5 flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-sm font-semibold text-brand-800 shadow-xl">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500 text-white">✓</span>
        ไม่ชนกันทุกคาบ
      </div>
      <div className="bob absolute -top-4 -left-3 rounded-full bg-sun-300 px-3 py-1 text-xs font-bold text-brand-900 shadow-lg [animation-delay:1.2s]">
        พักกลางวันคาบ {LUNCH}
      </div>
    </div>
  );
}

/** โครงหน้าเข้าสู่ระบบ: ซ้ายเป็นภาพตารางเคลื่อนไหว (จอใหญ่) ขวาเป็นฟอร์ม */
export function AuthCard({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen overflow-hidden bg-gradient-to-br from-brand-50 via-white to-sun-50">
      <aside className="relative hidden w-[46%] max-w-2xl flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-500 via-brand-700 to-brand-900 p-10 text-white lg:flex">
        <div className="float-slow pointer-events-none absolute -top-24 -right-20 h-80 w-80 rounded-full bg-sun-300/20 blur-2xl" aria-hidden="true" />
        <div className="float-slow pointer-events-none absolute -bottom-28 -left-16 h-96 w-96 rounded-full bg-brand-300/25 blur-3xl [animation-delay:-7s]" aria-hidden="true" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:22px_22px]"
          aria-hidden="true"
        />
        <div className="relative flex items-center gap-3">
          <LogoMark size={44} />
          <div className="leading-tight">
            <div className="text-lg font-bold">ระบบจัดตารางสอน</div>
            <div className="text-sm text-brand-100">อัตโนมัติ</div>
          </div>
        </div>
        <div className="relative">
          <h2 className="text-4xl leading-tight font-bold">
            จัดตารางสอนทั้งหลักสูตร
            <br />
            <span className="text-shimmer">ในไม่กี่วินาที</span>
          </h2>
          <div className="mt-10 max-w-md">
            <LiveTimetable />
          </div>
        </div>
        <div className="relative h-4" />
      </aside>
      <main className="relative flex flex-1 items-center justify-center px-4 py-10">
        <div className="float-slow pointer-events-none absolute top-[12%] right-[10%] h-56 w-56 rounded-full bg-sun-200/50 blur-3xl" aria-hidden="true" />
        <div className="float-slow pointer-events-none absolute bottom-[10%] left-[8%] h-64 w-64 rounded-full bg-brand-200/50 blur-3xl [animation-delay:-5s]" aria-hidden="true" />
        <div className="ring-glow relative w-full max-w-sm animate-[pop_.35s_ease-out] rounded-[1.4rem] p-[2px] shadow-xl shadow-brand-200/60">
          <div className="rounded-[1.3rem] bg-white/95 p-6 backdrop-blur">
            <div className="mb-6 flex flex-col items-center text-center">
              <LogoMark size={52} className="mb-3 drop-shadow-[0_8px_14px_rgba(44,129,80,0.35)]" />
              <h1 className="font-bold text-slate-800">ระบบจัดตารางสอนอัตโนมัติ</h1>
              <p className="text-sm text-slate-500">{subtitle}</p>
            </div>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username || !password || busy) return;
    setBusy(true);
    setError("");
    try {
      await login(username, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard subtitle="เข้าสู่ระบบ">
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="label">ชื่อผู้ใช้</span>
          <input className="input" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <div>
          <label htmlFor="login-password" className="label">
            รหัสผ่าน
          </label>
          <div className="relative">
            <input
              id="login-password"
              className="input pr-16"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShow((x) => !x)}
              aria-pressed={show}
              title={show ? "ซ่อนตัวอักษร" : "แสดงตัวอักษร"}
              className="absolute inset-y-0 right-1 my-auto h-8 cursor-pointer rounded-lg px-2 text-xs font-medium text-slate-500 hover:bg-slate-100"
            >
              {show ? "ซ่อน" : "แสดง"}
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary w-full" disabled={busy || !username || !password}>
          {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
        </button>
        <p className="text-center text-xs text-slate-400">นักเรียนและอาจารย์ขอชื่อผู้ใช้/รหัสผ่านจากผู้ดูแลเว็บไซต์</p>
      </form>
    </AuthCard>
  );
}
