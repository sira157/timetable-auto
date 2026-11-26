import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";

export type Tone = "ok" | "warn" | "error" | "muted" | "info" | "purple";

// ต้องเขียนชื่อคลาสเต็ม เพื่อให้ Tailwind ตรวจเจอตอน build
const BADGE_CLASS: Record<Tone, string> = {
  ok: "badge badge-ok",
  warn: "badge badge-warn",
  error: "badge badge-error",
  muted: "badge badge-muted",
  info: "badge badge-info",
  purple: "badge badge-purple",
};

export function Badge({ tone, children, strike }: { tone: Tone; children: ReactNode; strike?: boolean }) {
  return <span className={`${BADGE_CLASS[tone]} ${strike ? "line-through" : ""}`}>{children}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Alert({ tone, children, onClick }: { tone: "error" | "warn" | "ok" | "info"; children: ReactNode; onClick?: () => void }) {
  const cls = {
    error: "border-red-200 bg-red-50 text-red-800",
    warn: "border-amber-200 bg-amber-50 text-amber-800",
    ok: "border-green-200 bg-green-50 text-green-800",
    info: "border-brand-200 bg-brand-50 text-brand-800",
  }[tone];
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      role={tone === "error" ? "alert" : undefined}
      className={`block w-full rounded-xl border px-4 py-3 text-left text-sm ${cls} ${onClick ? "cursor-pointer hover:brightness-[0.98]" : ""}`}
    >
      {children}
    </Tag>
  );
}

export function Spinner({ label = "กำลังโหลด…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
      {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center">
      <p className="font-semibold text-slate-700">{title}</p>
      {children && <div className="mt-2 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

/** โหลดข้อมูลจาก API พร้อมสถานะ loading / error และฟังก์ชันโหลดใหม่ */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    api
      .get<T>(path)
      .then((d) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, tick]);

  return { data, error, loading, reload, setData };
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

/** ข้อความแจ้งผลชั่วคราวมุมล่าง */
export function useToast() {
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? (
    <div className="no-print fixed inset-x-4 bottom-4 z-[60] flex justify-center sm:inset-x-auto sm:right-6">
      <div
        role="status"
        className={`rounded-xl border px-4 py-3 text-sm shadow-lg ${
          msg.tone === "ok" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"
        }`}
      >
        {msg.text}
      </div>
    </div>
  ) : null;
  return {
    node,
    ok: (text: string) => setMsg({ text, tone: "ok" }),
    error: (text: string) => setMsg({ text, tone: "error" }),
  };
}

/** วงแหวนแสดงสัดส่วน (เช่น ชั่วโมงที่จัดได้) */
export function Ring({ value, total, size = 76 }: { value: number; total: number; size?: number }) {
  const pct = total > 0 ? Math.min(1, value / total) : 0;
  const r = 30;
  const c = 2 * Math.PI * r;
  const color = pct >= 1 ? "#16a34a" : pct >= 0.9 ? "#f59e0b" : "#dc2626";
  return (
    <svg width={size} height={size} viewBox="0 0 76 76" role="img" aria-label={`จัดได้ ${Math.round(pct * 100)} เปอร์เซ็นต์`}>
      <circle cx="38" cy="38" r={r} fill="none" stroke="#f0faf3" strokeWidth="9" />
      <circle
        cx="38"
        cy="38"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform="rotate(-90 38 38)"
        style={{ transition: "stroke-dasharray .8s ease" }}
      />
      <text x="38" y="43" textAnchor="middle" fontSize="15" fontWeight="700" fill="#1e293b">
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}
