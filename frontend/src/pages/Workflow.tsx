import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { IconArrowDown, IconArrowRight, IconBolt, IconUpload, IconX } from "../components/Icons";
import { PipelineArt, WorkbookArt } from "../components/Illustrations";
import Stepper from "../components/Stepper";
import { Alert, Badge, EmptyState, PageHeader, Spinner, formatDateTime, useApi, useToast, type Tone } from "../components/ui";
import { api, downloadFile } from "../lib/api";
import { FACTORS } from "../lib/factors";
import type { CheckResult, Course, Job, SampleInfo, Summary, VersionDetail, VersionSummary } from "../lib/types";

// ---------------- 1. นำเข้าข้อมูล ----------------

const ENTITY_LABEL: Record<string, string> = {
  teachers: "อาจารย์",
  groups: "กลุ่มเรียน",
  rooms: "ห้อง/สนาม",
  courses: "รายวิชา",
  sections: "การเปิดสอน",
  busy: "เวลาที่ไม่ว่าง",
  admins: "ฝ่ายบริหาร",
};

const ACCEPT = [".xlsx", ".csv", ".zip", ".json"];

function fileKind(name: string) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return { xlsx: "Excel", csv: "CSV", zip: "CSV (zip)", json: "JSON" }[ext] ?? "ไม่รองรับ";
}

export function ImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ counts: Record<string, number>; partial: boolean; warnings?: string[] } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const summary = useApi<Summary>("/api/data/summary");
  const samples = useApi<SampleInfo[]>("/api/samples");
  const toast = useToast();
  const navigate = useNavigate();
  const hasData = (summary.data?.counts.sections ?? 0) > 0 || (summary.data?.counts.teachers ?? 0) > 0;

  const csvOnly = files.length > 0 && files.every((f) => /\.(csv|zip)$/i.test(f.name));
  const invalid = files.filter((f) => !ACCEPT.some((ext) => f.name.toLowerCase().endsWith(ext)));
  const tooMany = !csvOnly && files.length > 1;
  const needConfirm = hasData && files.length > 0 && !csvOnly;

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((old) => {
      const merged = [...old, ...Array.from(list)];
      return merged.filter((f, i) => merged.findIndex((x) => x.name === f.name) === i);
    });
    setResult(null);
    setError("");
  }

  function onDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setOver(false);
    addFiles(e.dataTransfer.files);
  }

  async function doImport() {
    setBusy("file");
    setError("");
    setResult(null);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      const res = await api.post<{ counts: Record<string, number>; partial: boolean; warnings?: string[] }>("/api/import", fd);
      setResult(res);
      setFiles([]);
      setConfirm(false);
      summary.reload();
      toast.ok("นำเข้าแล้ว");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function importSample(size: string) {
    setBusy(size);
    setError("");
    setResult(null);
    try {
      const res = await api.post<{ counts: Record<string, number>; partial: boolean }>(`/api/import/sample?size=${size}`);
      setResult(res);
      summary.reload();
      toast.ok("นำเข้าชุดตัวอย่างแล้ว");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const dl = (path: string, name: string) => downloadFile(path, name).catch((e) => toast.error(e.message));

  return (
    <div>
      <Stepper current={0} nextReady={hasData} nextHint="นำเข้าข้อมูลก่อน" />
      <PageHeader title="นำเข้าข้อมูล" subtitle="ดาวน์โหลดแบบฟอร์ม → กรอกข้อมูล → ลากไฟล์มาวางที่นี่" />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            className={`flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-10 text-center transition ${
              over ? "scale-[1.01] border-indigo-400 bg-indigo-50" : "border-slate-300 bg-slate-50/60 hover:border-indigo-300 hover:bg-indigo-50/40"
            }`}
          >
            <span className={`flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 transition ${over ? "animate-bounce" : ""}`}>
              <IconUpload />
            </span>
            <span className="text-sm font-medium text-slate-700">ลากไฟล์มาวาง หรือกดเพื่อเลือก</span>
            <span className="text-xs text-slate-400">Excel (.xlsx) · CSV (.csv, .zip) · JSON · ไม่เกิน 10 MB</span>
          </button>
          <input ref={fileRef} type="file" multiple accept={ACCEPT.join(",")} className="hidden" onChange={(e) => addFiles(e.target.files)} />

          {files.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
              {files.map((f) => (
                <li key={f.name} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <Badge tone={fileKind(f.name) === "ไม่รองรับ" ? "error" : "info"}>{fileKind(f.name)}</Badge>
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="text-xs text-slate-400 tabular-nums">{(f.size / 1024).toFixed(1)} KB</span>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
                    aria-label={`เอา ${f.name} ออก`}
                    onClick={() => setFiles((x) => x.filter((y) => y !== f))}
                  >
                    <IconX width={16} height={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {files.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              {csvOnly ? "CSV: แทนที่เฉพาะส่วนที่มีในไฟล์ ส่วนอื่นคงเดิม" : "Excel/JSON: แทนที่ข้อมูลเดิมทั้งหมด"}
            </p>
          )}
          {invalid.length > 0 && <p className="mt-2 text-sm text-red-600">ไฟล์ {invalid.map((f) => f.name).join(", ")} ไม่รองรับ</p>}
          {tooMany && <p className="mt-2 text-sm text-red-600">Excel/JSON เลือกได้ครั้งละ 1 ไฟล์</p>}
          {needConfirm && (
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-indigo-600" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              แทนที่ข้อมูลเดิมทั้งหมด (ตารางที่คำนวณแล้วยังอยู่ แต่ควรคำนวณใหม่)
            </label>
          )}
          {error && (
            <div className="mt-4">
              <Alert tone="error">
                <div className="font-semibold">นำเข้าไม่สำเร็จ</div>
                <pre className="mt-1 max-h-48 overflow-y-auto font-sans text-sm whitespace-pre-wrap">{error}</pre>
              </Alert>
            </div>
          )}
          {result && (
            <div className="mt-4 animate-[pop_.35s_ease-out]">
              <Alert tone="ok">
                <div className="mb-1 font-semibold">นำเข้าสำเร็จ{result.partial ? " (บางส่วน)" : ""}</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {Object.entries(result.counts).map(([k, v]) => (
                    <span key={k}>
                      {ENTITY_LABEL[k] ?? k} <span className="font-semibold tabular-nums">{v}</span>
                    </span>
                  ))}
                </div>
              </Alert>
              {result.warnings && result.warnings.length > 0 && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">สิ่งที่ระบบอ่านจากไฟล์</div>
                  <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto text-sm">
                    {result.warnings.map((w, i) => (
                      <li key={i} className={`px-4 py-2 ${i === 0 ? "font-medium text-slate-800" : "text-slate-600"}`}>
                        {i > 0 && <span className="mr-1.5 text-amber-600" aria-hidden="true">•</span>}
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!files.length || Boolean(busy) || invalid.length > 0 || tooMany || (needConfirm && !confirm)}
              onClick={doImport}
            >
              {busy === "file" ? "กำลังนำเข้า…" : "นำเข้า"}
            </button>
            {result && (
              <button type="button" className="btn btn-ghost" onClick={() => navigate("/check")}>
                ตรวจข้อมูล <IconArrowRight />
              </button>
            )}
          </div>
        </div>

        <div className="card">
          <h2 className="mb-3 font-bold">ไฟล์ที่นำเข้าได้</h2>
          <WorkbookArt className="mb-4 w-full" />
          <ol className="space-y-4">
            <li className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
              <div className="flex items-center gap-2">
                <Badge tone="info">แนะนำ</Badge>
                <span className="font-semibold text-slate-800">Excel ข้อมูลหลักสูตร (.xlsx)</span>
              </div>
              <p className="mt-1 text-sm text-slate-600">แบบเดียวกับไฟล์ข้อมูลหลักสูตรที่ใช้อยู่</p>
              <ul className="mt-1 list-disc pl-5 text-xs text-slate-500">
                <li>ชีต ชั้นปีที่ 1–4: รายวิชาแยกตามกลุ่มเรียน</li>
                <li>ชีต ฝ่ายบริหาร: รายชื่ออาจารย์</li>
                <li>ชีต สถานที่เรียน: ห้องและสนาม</li>
              </ul>
              <p className="mt-1 text-xs text-slate-500">นำเข้าแล้วแทนที่ข้อมูลเดิมทั้งหมด</p>
              <button type="button" className="btn btn-primary mt-2 w-full" onClick={() => dl("/api/export/template.xlsx", "แบบฟอร์มข้อมูลหลักสูตร.xlsx")}>
                <IconArrowDown /> ดาวน์โหลดแบบฟอร์ม
              </button>
            </li>
            <li className="rounded-xl border border-slate-200 p-3">
              <div className="font-semibold text-slate-800">ไฟล์ที่ส่งออกจากระบบนี้</div>
              <p className="mt-1 text-sm text-slate-600">ดาวน์โหลดข้อมูลปัจจุบัน แก้ไข แล้วนำเข้ากลับ</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" className="btn btn-ghost" disabled={!hasData} onClick={() => dl("/api/export/data.xlsx", "ข้อมูลหลักสูตร.xlsx")}>
                  Excel
                </button>
                <button type="button" className="btn btn-ghost" disabled={!hasData} onClick={() => dl("/api/export/data.json", "ข้อมูล.json")}>
                  JSON
                </button>
              </div>
            </li>
            <li className="rounded-xl border border-slate-200 p-3">
              <div className="font-semibold text-slate-800">CSV (.csv หรือ .zip)</div>
              <p className="mt-1 text-sm text-slate-600">แก้เฉพาะบางส่วน เช่น รายชื่อห้อง ข้อมูลส่วนอื่นไม่เปลี่ยน</p>
              <button type="button" className="btn btn-ghost mt-2 w-full" onClick={() => dl("/api/export/template.zip", "แบบฟอร์ม-csv.zip")}>
                <IconArrowDown /> แบบฟอร์ม CSV
              </button>
            </li>
          </ol>
        </div>
      </div>

      <h2 className="mt-6 mb-1 font-bold">ชุดข้อมูลตัวอย่าง</h2>
      <p className="mb-3 text-sm text-slate-500">ข้อมูลสมมติ กด “นำเข้า” เพื่อลองทันที หรือดาวน์โหลดเป็น Excel ข้อมูลหลักสูตรไปดูวิธีกรอก</p>
      <div className="grid gap-4 md:grid-cols-3">
        {(samples.data ?? []).map((s) => (
          <div key={s.size} className="card flex flex-col transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-bold">ชุด{s.label}</h3>
              <Badge tone={s.size === "small" ? "ok" : s.size === "medium" ? "info" : "purple"}>{s.sections} การเปิดสอน</Badge>
            </div>
            <dl className="mb-4 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-slate-500">กลุ่มเรียน</dt>
              <dd className="text-right tabular-nums">{s.groups}</dd>
              <dt className="text-slate-500">อาจารย์</dt>
              <dd className="text-right tabular-nums">{s.teachers}</dd>
              <dt className="text-slate-500">รายวิชา</dt>
              <dd className="text-right tabular-nums">{s.courses}</dd>
              <dt className="text-slate-500">ห้อง/สนาม</dt>
              <dd className="text-right tabular-nums">{s.rooms}</dd>
            </dl>
            <button type="button" className="btn btn-primary mt-auto" disabled={Boolean(busy)} onClick={() => importSample(s.size)}>
              {busy === s.size ? "กำลังนำเข้า…" : "นำเข้า"}
            </button>
            <div className="mt-2 flex justify-center gap-3 text-xs">
              {(
                [
                  ["xlsx", "Excel"],
                  ["zip", "CSV"],
                  ["json", "JSON"],
                ] as const
              ).map(([fmt, label]) => (
                <button
                  key={fmt}
                  type="button"
                  className="min-h-8 cursor-pointer font-medium text-indigo-600 hover:text-indigo-700"
                  onClick={() => dl(`/api/samples/${s.size}.${fmt}`, `ตัวอย่าง.${fmt}`)}
                >
                  ↓ {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {toast.node}
    </div>
  );
}

// ---------------- 2. ตรวจสอบข้อมูล ----------------

const STATUS: Record<string, { tone: Tone; label: string }> = {
  ready: { tone: "ok", label: "พร้อม" },
  review: { tone: "warn", label: "ต้องตรวจ" },
  error: { tone: "error", label: "ผิดพลาด" },
  missing: { tone: "purple", label: "ไม่พบในทะเบียน" },
  skip: { tone: "muted", label: "ไม่ต้องจัด" },
};

export function CheckPage() {
  const { data, loading, error, reload } = useApi<CheckResult>("/api/data/check");
  const courses = useApi<Course[]>("/api/data/courses");
  const [filter, setFilter] = useState<string>("problems");
  const [q, setQ] = useState("");
  const courseMap = useMemo(() => new Map((courses.data ?? []).map((c) => [c.code, c])), [courses.data]);

  const rows = useMemo(() => {
    let r = data?.sections ?? [];
    if (filter === "problems") r = r.filter((x) => x.status !== "ready" && x.status !== "skip");
    else if (filter !== "all") r = r.filter((x) => x.status === filter);
    const n = q.trim().toLowerCase();
    if (n)
      r = r.filter((x) =>
        `${x.section?.course_code} ${courseMap.get(x.section?.course_code ?? "")?.name ?? ""} ${x.section?.group_codes.join(" ")} ${x.section?.teacher_codes.join(" ")}`
          .toLowerCase()
          .includes(n),
      );
    return r;
  }, [data, filter, q, courseMap]);

  const blocking = data ? (data.counts.error ?? 0) + (data.counts.missing ?? 0) + data.general.filter((g) => g.level === "error").length : 0;

  return (
    <div>
      <Stepper current={1} nextReady={Boolean(data && data.sections.length)} nextHint="ยังไม่มีข้อมูล" />
      <PageHeader
        title="ตรวจข้อมูล"
        subtitle="แก้รายการสีแดงและสีม่วงก่อนคำนวณ รายการเหล่านี้จะจัดไม่ได้"
        actions={
          <button type="button" className="btn btn-ghost" onClick={reload}>
            ตรวจอีกครั้ง
          </button>
        }
      />
      {loading && <Spinner />}
      {error && <Alert tone="error">{error}</Alert>}
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {Object.entries(STATUS).map(([k, v]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={`card cursor-pointer p-4 text-left transition hover:-translate-y-0.5 hover:border-indigo-200 ${filter === k ? "border-indigo-300 ring-4 ring-indigo-100" : ""}`}
              >
                <Badge tone={v.tone}>{v.label}</Badge>
                <div className="mt-2 text-2xl font-bold tabular-nums">{data.counts[k] ?? 0}</div>
              </button>
            ))}
          </div>

          {data.sections.length > 0 &&
            (blocking === 0 ? (
              <Alert tone="ok">
                ข้อมูลพร้อมคำนวณ{" "}
                <Link to="/run" className="font-semibold underline">
                  ไปคำนวณ →
                </Link>
              </Alert>
            ) : (
              <Alert tone="warn">มี {blocking} รายการที่ต้องแก้ ยังคำนวณได้ แต่รายการเหล่านี้จะไม่ลงตาราง</Alert>
            ))}

          {data.general.length > 0 && (
            <div className="card">
              <h2 className="mb-3 font-bold">ปัญหาทั่วไป</h2>
              <ul className="space-y-2 text-sm">
                {data.general.map((g, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Badge tone={g.level === "error" ? "error" : "warn"}>{g.level === "error" ? "ผิดพลาด" : "เตือน"}</Badge>
                    <span className="text-slate-700">{g.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4">
              <h2 className="mr-auto font-bold">การเปิดสอน</h2>
              <input className="input w-full sm:w-56" placeholder="ค้นหา รหัส/ชื่อวิชา/กลุ่ม/ผู้สอน" value={q} onChange={(e) => setQ(e.target.value)} />
              <select className="input w-full sm:w-auto" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="กรองสถานะ">
                <option value="problems">เฉพาะที่มีปัญหา</option>
                <option value="all">ทั้งหมด</option>
                {Object.entries(STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            {rows.length === 0 ? (
              <div className="p-4">
                <EmptyState title={data.sections.length ? "ไม่มีรายการในหมวดนี้" : "ยังไม่มีข้อมูล"}>
                  {!data.sections.length && (
                    <Link to="/import" className="font-medium text-indigo-600">
                      นำเข้าข้อมูล →
                    </Link>
                  )}
                </EmptyState>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>สถานะ</th>
                      <th>รายวิชา</th>
                      <th>กลุ่มเรียน</th>
                      <th>ผู้สอน</th>
                      <th>ปัญหา</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.section_id}>
                        <td>
                          <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                        </td>
                        <td>
                          <div className="font-medium whitespace-nowrap">{r.section?.course_code}</div>
                          <div className="text-xs text-slate-500">{courseMap.get(r.section?.course_code ?? "")?.name}</div>
                        </td>
                        <td className="text-slate-600">{r.section?.group_codes.join(", ")}</td>
                        <td className="text-slate-600">{r.section?.teacher_codes.join(", ") || "-"}</td>
                        <td className="text-slate-600">{r.messages.join(" · ") || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 3. คำนวณ ----------------

const PRIORITY_RULES: { factor: keyof typeof FACTORS; rules: string }[] = [
  { factor: "teacher", rules: "ห้ามสอนซ้อน · ไม่สอนตอนประชุมฝ่ายบริหาร (อังคาร 1–4) และพบที่ปรึกษา · สอนร่วมต้องว่างพร้อมกัน" },
  { factor: "room", rules: "ห้ามใช้ซ้อน · ที่นั่งต้องพอ · ห้องคอมฯ สำหรับนวัตกรรมฯ · วิชากีฬาจองห้อง + สนามพร้อมกัน" },
  { factor: "time", rules: "ไม่ลงคาบ 5 (พักเที่ยง) · พุธคาบ 8–9 · ชุดคาบวิชาเดียวกันคนละวัน · ไม่เกิน 3 คาบติดกัน" },
  { factor: "special", rules: "วิชาเลือกกีฬาเวลาเดียวกัน · เรียนรวมทั้งชั้นปี · เลือกเสรีศุกร์บ่าย · ปี 4 ฝึกสอนไม่ลงตาราง · คาบที่ล็อก" },
];

const SOFT_RULES = ["จัดครบทุกชั่วโมง", "คาบว่างระหว่างวันไม่เกิน 3 คาบ", "ทฤษฎีช่วงเช้า ปฏิบัติช่วงบ่าย", "เลี่ยงคาบ 9", "ใช้ห้องประจำชั้นปีก่อน"];

function useJob() {
  const [job, setJob] = useState<Job | null>(null);
  const timer = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const poll = useCallback(
    (id: string) => {
      stopPolling();
      const tick = async () => {
        try {
          const j = await api.get<Job>(`/api/schedule/jobs/${id}`);
          setJob(j);
          if (j.status === "running") timer.current = window.setTimeout(tick, 600);
        } catch (e) {
          setJob((old) => (old ? { ...old, status: "failed", message: (e as Error).message } : old));
        }
      };
      tick();
    },
    [stopPolling],
  );

  useEffect(() => {
    api
      .get<Job | null>("/api/schedule/jobs/current")
      .then((j) => {
        if (j && j.status === "running") {
          setJob(j);
          poll(j.id);
        }
      })
      .catch(() => undefined);
    return stopPolling;
  }, [poll, stopPolling]);

  return { job, setJob, poll };
}

function ProgressPanel({ job, onCancel }: { job: Job; onCancel: () => void }) {
  const budget = job.budget_sec ?? 0;
  return (
    <div className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4" role="status" aria-live="polite">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold text-indigo-800">
          <span className="h-2.5 w-2.5 animate-ping rounded-full bg-indigo-500" aria-hidden="true" />
          {job.phase_label}
        </div>
        <span className="text-sm text-indigo-700 tabular-nums">{job.percent}%</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-white">
        <div className="progress-stripes h-full rounded-full bg-indigo-600 transition-[width] duration-500" style={{ width: `${Math.max(3, job.percent)}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <span className="tabular-nums">
          ใช้เวลา {job.elapsed_sec.toFixed(0)}/{budget} วินาที
          {job.total_hours ? ` · จัดได้แล้ว ${job.placed_hours ?? 0}/${job.total_hours} ชม.` : ""}
        </span>
        <button type="button" className="btn btn-danger" onClick={onCancel}>
          ยกเลิก
        </button>
      </div>
    </div>
  );
}

export function RunPage() {
  const summary = useApi<Summary>("/api/data/summary");
  const versions = useApi<VersionSummary[]>("/api/schedule/versions");
  const [name, setName] = useState("");
  const [keepLocks, setKeepLocks] = useState(true);
  const [startError, setStartError] = useState("");
  const [result, setResult] = useState<VersionDetail | null>(null);
  const { job, setJob, poll } = useJob();
  const toast = useToast();
  const navigate = useNavigate();
  const running = job?.status === "running";

  useEffect(() => {
    if (job?.status === "done" && job.version_id && result?.id !== job.version_id) {
      api.get<VersionDetail>(`/api/schedule/versions/${job.version_id}`).then(setResult).catch(() => undefined);
      versions.reload();
      summary.reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, job?.version_id]);

  async function start(opts?: { name?: string; keep_locks?: boolean }) {
    setStartError("");
    setResult(null);
    try {
      const j = await api.post<Job>("/api/schedule/run", { name: opts?.name ?? name, keep_locks: opts?.keep_locks ?? keepLocks });
      setJob(j);
      poll(j.id);
    } catch (e) {
      setStartError((e as Error).message);
    }
  }

  async function cancel() {
    if (!job) return;
    try {
      await api.post(`/api/schedule/jobs/${job.id}/cancel`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function activate(id: number) {
    try {
      await api.post(`/api/schedule/versions/${id}/activate`);
      toast.ok("เลือกใช้ตารางนี้แล้ว");
      versions.reload();
      summary.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove(id: number) {
    try {
      await api.del(`/api/schedule/versions/${id}`);
      toast.ok("ลบแล้ว");
      versions.reload();
      summary.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const s = summary.data;
  const blocked = s && (s.counts.sections === 0 || s.settings_problems.length > 0);

  return (
    <div>
      <Stepper current={2} nextReady={Boolean(s?.active) && !running} nextHint="คำนวณก่อน" />
      <PageHeader title="คำนวณตาราง" subtitle="ระบบจัดวัน คาบ ห้อง และสนามพร้อมกัน ตามลำดับความสำคัญด้านขวา" />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card lg:col-span-3">
          {s && s.counts.sections === 0 && (
            <div className="mb-4">
              <Alert tone="warn">
                ยังไม่มีข้อมูล{" "}
                <Link to="/import" className="font-semibold underline">
                  นำเข้า
                </Link>
              </Alert>
            </div>
          )}
          {s && s.settings_problems.length > 0 && (
            <div className="mb-4">
              <Alert tone="error">
                ตั้งค่าเวลาไม่ถูกต้อง{" "}
                <Link to="/system/settings" className="font-semibold underline">
                  แก้ไข
                </Link>
              </Alert>
            </div>
          )}
          <div className="grid gap-4">
            <label className="block">
              <span className="label">ชื่อตาราง (ไม่บังคับ)</span>
              <input className="input" value={name} placeholder="เช่น ภาคเรียนที่ 1/2569" disabled={running} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-700">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-indigo-600" checked={keepLocks} disabled={running} onChange={(e) => setKeepLocks(e.target.checked)} />
              <span>
                คงคาบที่ล็อกไว้
                <span className="block text-xs text-slate-400">ล็อกได้ในหน้าตรวจผล โดยกดที่วิชา</span>
              </span>
            </label>
          </div>
          <div className="mt-5">
            <button type="button" className="btn btn-primary px-6" onClick={() => start()} disabled={running || Boolean(blocked)}>
              <IconBolt /> {running ? "กำลังคำนวณ…" : "เริ่มคำนวณ"}
            </button>
          </div>
          {startError && (
            <div className="mt-4">
              <Alert tone="error">{startError}</Alert>
            </div>
          )}
          {job && running && <ProgressPanel job={job} onCancel={cancel} />}
          {job && (job.status === "cancelled" || job.status === "failed") && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <span className={`text-sm ${job.status === "failed" ? "text-red-700" : "text-slate-600"}`}>{job.message}</span>
              <button type="button" className="btn btn-primary" onClick={() => start(job.options)}>
                ลองใหม่
              </button>
            </div>
          )}
          {result && job?.status === "done" && (
            <RunResult
              v={result}
              onRetry={() => start({ name: "", keep_locks: keepLocks })}
              onNext={() => navigate("/timetable")}
            />
          )}
        </div>

        <div className="card lg:col-span-2">
          <h2 className="mb-1 font-bold">ระบบตัดสินอย่างไร</h2>
          <PipelineArt className="my-3 w-full" />
          <p className="mb-3 text-sm text-slate-500">ข้อบังคับ (ห้ามผิด)</p>
          <ul className="space-y-3">
            {PRIORITY_RULES.map((p) => (
              <li key={p.factor} className="flex gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-base" aria-hidden="true">
                  {FACTORS[p.factor].icon}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800">{FACTORS[p.factor].label}</div>
                  <div className="text-xs text-slate-500">{p.rules}</div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 mb-2 text-sm text-slate-500">ถ้าทำได้ (เรียงจากสำคัญมากไปน้อย)</p>
          <ol className="space-y-1.5 text-sm">
            {SOFT_RULES.map((r, i) => (
              <li key={r} className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[11px] font-bold text-indigo-600">{i + 1}</span>
                {r}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="mt-6 card p-0">
        <div className="border-b border-slate-200 p-4">
          <h2 className="font-bold">ตารางที่คำนวณไว้</h2>
        </div>
        {versions.loading && <Spinner />}
        {versions.data && versions.data.length === 0 && <p className="p-4 text-sm text-slate-500">ยังไม่มี</p>}
        {versions.data && versions.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ชื่อ</th>
                  <th>คำนวณเมื่อ</th>
                  <th>จัดได้</th>
                  <th>ผลตรวจ</th>
                  <th className="text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {versions.data.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <div className="font-medium">{v.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {v.is_active && <Badge tone="ok">ใช้งานอยู่</Badge>}
                        {v.data_changed && <Badge tone="warn">ข้อมูลเปลี่ยนหลังคำนวณ</Badge>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-slate-600">{formatDateTime(v.created_at)}</td>
                    <td className="whitespace-nowrap tabular-nums">
                      {v.stats.placed_hours}/{v.stats.total_hours} ชม.
                    </td>
                    <td>
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={v.errors ? "error" : "ok"}>ผิดพลาด {v.errors}</Badge>
                        <Badge tone={v.warnings ? "warn" : "ok"}>เตือน {v.warnings}</Badge>
                        {v.unplaced > 0 && <Badge tone="error">จัดไม่ได้ {v.unplaced}</Badge>}
                      </span>
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <span className="inline-flex gap-2">
                        {!v.is_active && (
                          <button type="button" className="btn btn-ghost" onClick={() => activate(v.id)}>
                            ใช้ตารางนี้
                          </button>
                        )}
                        <Link to={`/timetable?version=${v.id}`} className="btn btn-ghost">
                          ดู
                        </Link>
                        {!v.is_active && (
                          <button type="button" className="btn btn-danger" onClick={() => remove(v.id)}>
                            ลบ
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {toast.node}
    </div>
  );
}

function RunResult({ v, onRetry, onNext }: { v: VersionDetail; onRetry: () => void; onNext: () => void }) {
  const complete = v.stats.placed_hours === v.stats.total_hours && v.unplaced.length === 0;
  const good = complete && v.errors === 0;
  return (
    <div className="mt-5 animate-[pop_.4s_ease-out] space-y-3">
      <div className={`flex items-center gap-4 rounded-2xl border p-4 ${good ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
        <span
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-2xl ${good ? "bg-green-600 text-white" : "bg-amber-500 text-white"}`}
          aria-hidden="true"
        >
          {good ? "✓" : "!"}
        </span>
        <div className="min-w-0">
          <div className={`font-bold ${good ? "text-green-800" : "text-amber-800"}`}>
            {complete ? "จัดได้ครบทุกวิชา" : `จัดได้ ${v.stats.placed_hours}/${v.stats.total_hours} ชม.`}
          </div>
          <div className="text-sm text-slate-600">
            ผิดพลาด {v.errors} · เตือน {v.warnings} · {(v.stats.duration_ms / 1000).toFixed(1)} วินาที
            {v.stats.locks_kept > 0 && ` · คงคาบที่ล็อก ${v.stats.locks_kept}`}
          </div>
        </div>
      </div>
      {v.unplaced.length > 0 && (
        <div className="rounded-xl border border-red-200">
          <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800">จัดไม่ได้ {v.unplaced.length} รายการ</div>
          <ul className="divide-y divide-slate-100 text-sm">
            {v.unplaced.slice(0, 8).map((u, i) => (
              <li key={i} className="flex flex-wrap items-start gap-2 px-4 py-2.5">
                {u.factor && (
                  <span className="text-base" title={FACTORS[u.factor].label} aria-label={FACTORS[u.factor].label}>
                    {FACTORS[u.factor].icon}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {u.course_code} {u.course_name} <span className="font-normal text-slate-500">({u.group_codes.join(", ")})</span>
                  </div>
                  <div className="text-slate-600">{u.reason}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={onNext}>
          ตรวจผล <IconArrowRight />
        </button>
        <button type="button" className="btn btn-ghost" onClick={onRetry}>
          คำนวณใหม่
        </button>
      </div>
    </div>
  );
}
