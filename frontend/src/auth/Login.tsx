import { useState, type FormEvent, type ReactNode } from "react";
import { LogoMark, TimetableArt } from "../components/Illustrations";
import { useAuth } from "./AuthContext";

const FEATURES = [
  { n: 1, title: "นำเข้าไฟล์ Excel ข้อมูลหลักสูตร", desc: "รายวิชา อาจารย์ ห้อง และสนาม" },
  { n: 2, title: "ระบบจัดตารางให้อัตโนมัติ", desc: "ครู ห้อง เวลา ไม่ชนกัน ครบทุกเงื่อนไข" },
  { n: 3, title: "ลากปรับ แล้วส่งออก", desc: "PDF · Excel · CSV" },
];

/** โครงหน้าเข้าสู่ระบบ: ซ้ายเป็นภาพอธิบายระบบ (จอใหญ่) ขวาเป็นฟอร์ม */
export function AuthCard({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-gradient-to-br from-indigo-50 via-white to-violet-50">
      <aside className="relative hidden w-[46%] max-w-2xl flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-600 to-violet-700 p-10 text-white lg:flex">
        <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-white/10" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-violet-400/20" aria-hidden="true" />
        <div className="relative flex items-center gap-3">
          <LogoMark size={44} />
          <div className="leading-tight">
            <div className="text-lg font-bold">ระบบจัดตารางสอน</div>
            <div className="text-sm text-indigo-100">อัตโนมัติ</div>
          </div>
        </div>
        <div className="relative">
          <h2 className="text-3xl leading-snug font-bold">
            จัดตารางสอนทั้งหลักสูตร
            <br />
            ในไม่กี่วินาที
          </h2>
          <TimetableArt className="mt-6 w-full max-w-md drop-shadow-2xl" />
        </div>
        <ol className="relative space-y-3">
          {FEATURES.map((f) => (
            <li key={f.n} className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-bold">{f.n}</span>
              <span>
                <span className="block font-semibold">{f.title}</span>
                <span className="text-sm text-indigo-100">{f.desc}</span>
              </span>
            </li>
          ))}
        </ol>
      </aside>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm animate-[pop_.35s_ease-out] rounded-2xl border border-slate-200/80 bg-white p-6 shadow-lg shadow-indigo-100">
          <div className="mb-6 flex flex-col items-center text-center">
            <LogoMark size={52} className="mb-3 drop-shadow-[0_6px_12px_rgba(99,102,241,0.3)]" />
            <h1 className="font-bold text-slate-800">ระบบจัดตารางสอนอัตโนมัติ</h1>
            <p className="text-sm text-slate-500">{subtitle}</p>
          </div>
          {children}
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
