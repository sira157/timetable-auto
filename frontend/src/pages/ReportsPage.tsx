import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ExportPanel from "../components/ExportPanel";
import { IconArrowDown } from "../components/Icons";
import Stepper from "../components/Stepper";
import { Alert, EmptyState, PageHeader, Spinner, formatDateTime, useApi, useToast } from "../components/ui";
import { downloadFile } from "../lib/api";
import { FACTORS, FACTOR_STYLE, issueInfo } from "../lib/factors";
import type { Factor, Group, Room, Teacher, VersionDetail, VersionSummary } from "../lib/types";

const LIST_EXPORTS = [
  { key: "teacher_load", label: "ภาระงานสอนรายบุคคล" },
  { key: "issues", label: "ผลตรวจ (ผิดพลาด/เตือน)" },
  { key: "unplaced", label: "วิชาที่จัดไม่ได้" },
];

export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const versions = useApi<VersionSummary[]>("/api/schedule/versions");
  const vid = params.get("version") ?? String(versions.data?.find((v) => v.is_active)?.id ?? versions.data?.[0]?.id ?? "");
  const detail = useApi<VersionDetail>(vid ? `/api/schedule/versions/${vid}` : null);
  const load = useApi<{ rows: (string | number)[][] }>(vid ? `/api/reports/teacher_load?version_id=${vid}&format=json` : null);
  const teachers = useApi<Teacher[]>("/api/data/teachers");
  const groups = useApi<Group[]>("/api/data/groups");
  const rooms = useApi<Room[]>("/api/data/rooms");
  const [factor, setFactor] = useState<Factor | "all">("all");
  const [level, setLevel] = useState<"all" | "error" | "warning">("all");
  const [loadQ, setLoadQ] = useState("");
  const toast = useToast();

  const issues = useMemo(
    () =>
      (detail.data?.issues ?? [])
        .map((i) => ({ ...i, ...issueInfo(i.type) }))
        .filter((i) => (level === "all" || i.level === level) && (factor === "all" || i.factor === factor)),
    [detail.data, level, factor],
  );
  const factorCount = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of detail.data?.issues ?? []) {
      const f = issueInfo(i.type).factor;
      c[f] = (c[f] ?? 0) + 1;
    }
    return c;
  }, [detail.data]);

  const opts = {
    group: (groups.data ?? []).filter((g) => !g.is_excluded).map((g) => ({ id: String(g.id), label: g.name })),
    teacher: (teachers.data ?? []).filter((t) => !t.is_excluded).map((t) => ({ id: String(t.id), label: t.name })),
    room: (rooms.data ?? []).map((r) => ({ id: r.name, label: r.name })),
  };

  if (versions.loading) return <Spinner />;
  if (!versions.data?.length)
    return (
      <div>
        <Stepper current={4} />
        <PageHeader title="ส่งออก" />
        <EmptyState title="ยังไม่ได้คำนวณตาราง">
          <Link to="/run" className="font-medium text-indigo-600">
            ไปคำนวณ →
          </Link>
        </EmptyState>
      </div>
    );

  const d = detail.data;
  const loadRows = (load.data?.rows ?? []).slice(1).filter((r) => !loadQ || String(r[0]).includes(loadQ));
  const maxLoad = Math.max(1, ...loadRows.map((r) => Number(r[1]) || 0));

  return (
    <div>
      <Stepper current={4} />
      <PageHeader title="รายงาน / ส่งออก" subtitle="ดูปัญหาที่เหลือ แล้วส่งออกเป็น PDF, Excel หรือ CSV" />
      <div className="no-print card mb-4 p-4">
        <label className="block sm:max-w-sm">
          <span className="label">ตารางรุ่น</span>
          <select className="input" value={vid} onChange={(e) => setParams({ version: e.target.value }, { replace: true })}>
            {versions.data.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.is_active ? " (ใช้งานอยู่)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {detail.loading && <Spinner />}
      {detail.error && <Alert tone="error">{detail.error}</Alert>}
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: "จัดได้", value: `${d.stats.placed_hours}/${d.stats.total_hours}`, sub: "ชั่วโมงต่อสัปดาห์", bad: d.stats.placed_hours < d.stats.total_hours },
              { label: "ผิดพลาด", value: d.errors, sub: d.errors ? "ต้องแก้" : "ไม่มี", bad: d.errors > 0 },
              { label: "เตือน", value: d.warnings, sub: "แก้หรือไม่ก็ได้", bad: false, warn: d.warnings > 0 },
              { label: "จัดไม่ได้", value: d.unplaced.length, sub: "รายการ", bad: d.unplaced.length > 0 },
            ].map((c) => (
              <div key={c.label} className="card">
                <div className="text-sm text-slate-500">{c.label}</div>
                <div className={`mt-1 text-2xl font-bold tabular-nums ${c.bad ? "text-red-600" : c.warn ? "text-amber-600" : "text-green-600"}`}>{c.value}</div>
                <div className="text-xs text-slate-400">{c.sub}</div>
              </div>
            ))}
          </div>
          <p className="text-sm text-slate-500">
            {d.name} · {formatDateTime(d.created_at)} · {d.created_by || "-"} · {(d.stats.duration_ms / 1000).toFixed(1)} วินาที
          </p>

          <div className="card p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4">
              <h2 className="mr-auto font-bold">ปัญหาที่เหลือ</h2>
              <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                {(
                  [
                    ["all", "ทั้งหมด"],
                    ["error", "ผิดพลาด"],
                    ["warning", "เตือน"],
                  ] as const
                ).map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setLevel(k)}
                    className={`min-h-9 cursor-pointer rounded-lg px-3 text-sm font-medium ${level === k ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600"}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3">
              <button
                type="button"
                onClick={() => setFactor("all")}
                className={`min-h-9 cursor-pointer rounded-full border px-3 text-sm ${factor === "all" ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600"}`}
              >
                ทุกหมวด
              </button>
              {(Object.keys(FACTORS) as Factor[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFactor(f)}
                  title={FACTORS[f].desc}
                  className={`min-h-9 cursor-pointer rounded-full border px-3 text-sm transition ${factor === f ? FACTOR_STYLE[f] : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                >
                  {FACTORS[f].icon} {FACTORS[f].label} <span className="tabular-nums">({factorCount[f] ?? 0})</span>
                </button>
              ))}
            </div>
            {issues.length === 0 ? (
              <p className="p-4 text-sm text-green-700">✓ ไม่มีปัญหาในหมวดนี้</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {issues.map((i, n) => (
                  <li key={n} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                    <span className={`mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 text-xs ${FACTOR_STYLE[i.factor]}`}>
                      {FACTORS[i.factor].icon} {FACTORS[i.factor].label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={i.level === "error" ? "text-red-700" : "text-amber-800"}>{i.message}</div>
                      {i.fix && <div className="text-xs text-slate-500">แก้: {i.fix}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {d.unplaced.length > 0 && (
            <div className="card p-0">
              <div className="border-b border-slate-200 p-4">
                <h2 className="font-bold">จัดไม่ได้</h2>
              </div>
              <ul className="divide-y divide-slate-100">
                {d.unplaced.map((u, i) => (
                  <li key={i} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                    {u.factor && (
                      <span className={`mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 text-xs ${FACTOR_STYLE[u.factor]}`}>
                        {FACTORS[u.factor].icon} {FACTORS[u.factor].label}
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="font-medium">
                        {u.course_code} {u.course_name} <span className="font-normal text-slate-500">· {u.group_codes.join(", ")}</span>
                      </div>
                      <div className="text-slate-600">{u.reason}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="no-print card">
            <h2 className="mb-1 font-bold">ส่งออกตารางทั้งหมด</h2>
            <p className="mb-4 text-sm text-slate-500">PDF หน้าละ 1 ตาราง · Excel ชีตละ 1 ตาราง · CSV เป็นรายการคาบ</p>
            <div className="space-y-3">
              {(
                [
                  ["group", "ตารางเรียนทุกชั้นปี", opts.group],
                  ["teacher", "ตารางสอนอาจารย์ทุกคน", opts.teacher],
                  ["room", "ตารางห้องและสนาม", opts.room],
                ] as const
              ).map(([view, label, list]) => (
                <div key={view} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2.5">
                  <span className="text-sm font-medium text-slate-700">
                    {label} <span className="text-slate-400 tabular-nums">({list.length})</span>
                  </span>
                  <ExportPanel versionId={vid} view={view} current={list[0] ?? null} all={list} allOnly onError={toast.error} />
                </div>
              ))}
              {LIST_EXPORTS.map((x) => (
                <div key={x.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2.5">
                  <span className="text-sm font-medium text-slate-700">{x.label}</span>
                  <span className="flex gap-2">
                    {(["xlsx", "csv"] as const).map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => downloadFile(`/api/reports/${x.key}?version_id=${vid}&format=${fmt}`, `${x.label}.${fmt}`).catch((e) => toast.error(e.message))}
                      >
                        <IconArrowDown /> {fmt === "xlsx" ? "Excel" : "CSV"}
                      </button>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">ภาระงานสอน (ชม./สัปดาห์)</h2>
              <input className="input w-full sm:w-56" placeholder="ค้นหาชื่ออาจารย์" value={loadQ} onChange={(e) => setLoadQ(e.target.value)} />
            </div>
            {load.loading && <Spinner />}
            <ul className="grid gap-x-8 gap-y-2 md:grid-cols-2">
              {loadRows.map((r) => (
                <li key={String(r[0])} className="grid grid-cols-[minmax(0,9rem)_1fr_2rem] items-center gap-3 text-sm">
                  <span className="truncate text-slate-700" title={String(r[0])}>
                    {r[0]}
                  </span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${((Number(r[1]) || 0) / maxLoad) * 100}%` }} />
                  </span>
                  <span className="text-right font-semibold tabular-nums">{r[1]}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {toast.node}
    </div>
  );
}
