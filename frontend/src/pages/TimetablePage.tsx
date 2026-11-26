import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ExportPanel from "../components/ExportPanel";
import { IconLock, IconSearch } from "../components/Icons";
import Modal from "../components/Modal";
import Stepper from "../components/Stepper";
import TimetableGrid, { type DragSupport } from "../components/TimetableGrid";
import { Alert, Badge, EmptyState, PageHeader, Spinner, useApi, useToast } from "../components/ui";
import { api } from "../lib/api";
import type { Entry, Group, Moves, MoveSlot, Room, Teacher, Timetable, VersionSummary, View } from "../lib/types";

const VIEWS: { key: View; label: string }[] = [
  { key: "group", label: "ชั้นปี" },
  { key: "teacher", label: "อาจารย์" },
  { key: "room", label: "ห้อง/สนาม" },
  { key: "building", label: "อาคาร" },
];

type Option = { id: string; label: string; head?: string };

export default function TimetablePage() {
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as View) || "group";
  const versions = useApi<VersionSummary[]>("/api/schedule/versions");
  const teachers = useApi<Teacher[]>("/api/data/teachers");
  const groups = useApi<Group[]>("/api/data/groups");
  const rooms = useApi<Room[]>("/api/data/rooms");
  const toast = useToast();
  const [search, setSearch] = useState("");

  const versionId = params.get("version") ?? String(versions.data?.find((v) => v.is_active)?.id ?? versions.data?.[0]?.id ?? "");
  const version = versions.data?.find((v) => String(v.id) === versionId);

  const options: Option[] = useMemo(() => {
    if (view === "teacher")
      return (teachers.data ?? [])
        .filter((t) => !t.is_excluded)
        .map((t) => ({ id: String(t.id), label: t.name }))
        .sort((a, b) => a.label.localeCompare(b.label, "th"));
    if (view === "group")
      return (groups.data ?? [])
        .filter((g) => !g.is_excluded)
        .sort((a, b) => a.year - b.year || a.code.localeCompare(b.code))
        .map((g) => ({ id: String(g.id), label: g.name, head: `ชั้นปีที่ ${g.year}` }));
    if (view === "room")
      return (rooms.data ?? [])
        .map((r) => ({ id: r.name, label: r.name, head: r.kind === "field" ? "สนาม/โรงยิม" : r.kind === "computer" ? "ห้องคอมพิวเตอร์" : "ห้องเรียน/ห้องประชุม" }))
        .sort((a, b) => a.head.localeCompare(b.head, "th") || a.label.localeCompare(b.label, "th"));
    return [...new Set((rooms.data ?? []).map((r) => r.building).filter(Boolean))].map((x) => ({ id: x, label: x }));
  }, [view, teachers.data, groups.data, rooms.data]);

  const grouped = useMemo(() => {
    const m = new Map<string, Option[]>();
    for (const o of options) m.set(o.head ?? "", [...(m.get(o.head ?? "") ?? []), o]);
    return [...m.entries()];
  }, [options]);

  const selectedParam = params.get("id");
  const selected = selectedParam && options.some((o) => o.id === selectedParam) ? selectedParam : options[0]?.id ?? "";
  const current = options.find((o) => o.id === selected) ?? null;
  const path = versionId && selected ? `/api/schedule/versions/${versionId}/timetable?view=${view}&id=${encodeURIComponent(selected)}` : null;
  const tt = useApi<Timetable>(path);
  const [detail, setDetail] = useState<Entry | null>(null);

  // ---- ลากวาง ----
  const [dragging, setDragging] = useState<Entry | null>(null);
  const [slots, setSlots] = useState<Map<string, MoveSlot> | null>(null);

  function update(next: Record<string, string>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  }

  async function move(entry: Entry, day: number, start: number) {
    try {
      const res = await api.patch<{ errors: number; warnings: number }>(`/api/schedule/assignments/${entry.id}`, { day, start });
      toast.ok(`ย้าย ${entry.course_code} แล้ว · ผิดพลาด ${res.errors} · เตือน ${res.warnings}`);
      tt.reload();
      versions.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const drag: DragSupport = {
    dragging,
    slots,
    onDragStart: (e) => {
      setDragging(e);
      setSlots(null);
      api
        .get<Moves>(`/api/schedule/assignments/${e.id}/moves`)
        .then((m) => setSlots(new Map(m.slots.map((s) => [`${s.day}-${s.start}`, s]))))
        .catch((err) => toast.error(err.message));
    },
    onDragEnd: () => {
      setDragging(null);
      setSlots(null);
    },
    onDrop: (day, start) => {
      const e = dragging;
      setDragging(null);
      setSlots(null);
      if (e && (day !== e.day || start !== e.start)) move(e, day, start);
    },
  };

  const idx = options.findIndex((o) => o.id === selected);

  if (versions.loading) return <Spinner />;
  if (versions.error) return <Alert tone="error">{versions.error}</Alert>;
  if (!versions.data?.length)
    return (
      <div>
        <Stepper current={3} nextReady={false} />
        <PageHeader title="ตารางสอน" />
        <EmptyState title="ยังไม่ได้คำนวณตาราง">
          <Link to="/run" className="font-medium text-indigo-600">
            ไปคำนวณ →
          </Link>
        </EmptyState>
      </div>
    );

  return (
    <div>
      <Stepper current={3} />
      <PageHeader title="ตารางสอน" subtitle="ลากวิชาไปช่องสีเขียวเพื่อย้าย · กดวิชาเพื่อล็อกหรือเปลี่ยนห้อง" />

      <div className="no-print card mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
          <label className="block">
            <span className="label">ดูตาม</span>
            <select className="input" value={view} onChange={(e) => update({ view: e.target.value, id: "" })}>
              {VIEWS.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="label">{VIEWS.find((v) => v.key === view)?.label}</span>
            <div className="flex gap-1.5">
              <button type="button" className="btn btn-ghost w-10 shrink-0 px-0" disabled={idx <= 0} onClick={() => update({ id: options[idx - 1].id })} aria-label="ก่อนหน้า">
                ‹
              </button>
              <select className="input min-w-0" value={selected} onChange={(e) => update({ id: e.target.value })}>
                {grouped.map(([head, list]) =>
                  head ? (
                    <optgroup key={head} label={head}>
                      {list.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : (
                    list.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))
                  ),
                )}
              </select>
              <button
                type="button"
                className="btn btn-ghost w-10 shrink-0 px-0"
                disabled={idx < 0 || idx >= options.length - 1}
                onClick={() => update({ id: options[idx + 1].id })}
                aria-label="ถัดไป"
              >
                ›
              </button>
            </div>
          </label>
          <label className="block min-w-0">
            <span className="label">ตารางรุ่น</span>
            <select className="input" value={versionId} onChange={(e) => update({ version: e.target.value })}>
              {versions.data.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.is_active ? " (ใช้งานอยู่)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="label">ค้นในตาราง</span>
            <div className="relative">
              <IconSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
              <input className="input pl-9" placeholder="รหัส/ชื่อวิชา ผู้สอน ห้อง" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <span className="text-sm font-medium text-slate-600">ส่งออก</span>
          <ExportPanel versionId={versionId} view={view} current={current} all={options} onError={toast.error} />
        </div>
      </div>

      {version && (version.errors > 0 || version.data_changed) && (
        <div className="no-print mb-4 space-y-2">
          {version.errors > 0 && (
            <Alert tone="error">
              มีข้อผิดพลาด {version.errors} รายการ{" "}
              <Link to={`/reports?version=${version.id}`} className="font-semibold underline">
                ดูวิธีแก้
              </Link>
            </Alert>
          )}
          {version.data_changed && <Alert tone="warn">ข้อมูลเปลี่ยนหลังคำนวณ ควรคำนวณใหม่</Alert>}
        </div>
      )}

      {tt.loading && !tt.data && <Spinner />}
      {tt.error && <Alert tone="error">{tt.error}</Alert>}
      {!selected && <EmptyState title="ไม่มีรายการ" />}
      {tt.data && selected && <TimetableGrid tt={tt.data} onSelect={setDetail} drag={drag} search={search} />}

      <EntryModal
        entry={detail}
        tt={tt.data}
        rooms={rooms.data ?? []}
        onPick={setDetail}
        onClose={() => setDetail(null)}
        onSaved={(msg) => {
          toast.ok(msg);
          setDetail(null);
          tt.reload();
          versions.reload();
        }}
        onError={(m) => toast.error(m)}
      />
      {toast.node}
    </div>
  );
}

function EntryModal({
  entry,
  tt,
  rooms,
  onPick,
  onClose,
  onSaved,
  onError,
}: {
  entry: Entry | null;
  tt: Timetable | null;
  rooms: Room[];
  onPick: (e: Entry) => void;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [day, setDay] = useState(0);
  const [start, setStart] = useState(1);
  const [room, setRoom] = useState("");
  const [fieldName, setFieldName] = useState("");
  const [busy, setBusy] = useState(false);
  const [moves, setMoves] = useState<Moves | null>(null);

  useEffect(() => {
    if (entry) {
      setDay(entry.day);
      setStart(entry.start);
      setRoom(entry.room ?? "");
      setFieldName(entry.field ?? "");
      setMoves(null);
      api.get<Moves>(`/api/schedule/assignments/${entry.id}/moves`).then(setMoves).catch(() => setMoves(null));
    }
  }, [entry]);

  if (!entry || !tt) return null;
  const moved = day !== entry.day || start !== entry.start;
  const roomChanged = room !== (entry.room ?? "") || fieldName !== (entry.field ?? "");
  const usesField = entry.part === "both" || Boolean(entry.field);
  const slotMap = new Map((moves?.slots ?? []).map((s) => [`${s.day}-${s.start}`, s]));
  const target = slotMap.get(`${day}-${start}`);
  const roomOptions = rooms.filter((r) => r.kind !== "field");
  const fieldOptions = rooms.filter((r) => r.kind === "field");
  const linked = entry.kind === "elective" || entry.kind === "free";

  async function patch(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    try {
      const res = await api.patch<{ errors: number; warnings: number }>(`/api/schedule/assignments/${entry!.id}`, body);
      onSaved(`${msg} · ผิดพลาด ${res.errors} · เตือน ${res.warnings}`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const p1 = tt.periods.find((p) => p.no === entry.start);
  const p2 = tt.periods.find((p) => p.no === entry.start + entry.length - 1);

  return (
    <Modal
      open
      title={`${entry.course_code} ${entry.course_name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => patch({ locked: !entry.locked }, entry.locked ? "ปลดล็อกแล้ว" : "ล็อกแล้ว")}>
            <IconLock /> {entry.locked ? "ปลดล็อก" : "ล็อกคาบนี้"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || (!moved && !roomChanged) || (moved && target !== undefined && !target.ok)}
            onClick={() => patch({ ...(moved ? { day, start } : {}), ...(roomChanged ? { room, field: fieldName } : {}) }, "บันทึกแล้ว")}
          >
            {busy ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </>
      }
    >
      {entry.parts && entry.parts.length > 1 && (
        <div className="mb-4">
          <p className="mb-1.5 text-sm text-slate-600">วิชานี้เรียนต่อกันในห้องเดียวกัน เลือกช่วงที่จะแก้ไข</p>
          <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 text-sm" role="radiogroup" aria-label="ช่วงคาบ">
            {entry.parts.map((x) => (
              <button
                key={x.id}
                type="button"
                role="radio"
                aria-checked={x.id === entry.id}
                className={`rounded-lg px-3 py-1.5 ${x.id === entry.id ? "bg-white font-semibold text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                onClick={() => onPick({ ...x, parts: entry.parts })}
              >
                คาบ {x.start}
                {x.length > 1 ? `–${x.start + x.length - 1}` : ""}
              </button>
            ))}
          </div>
        </div>
      )}
      <dl className="mb-5 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-slate-500">หน่วยกิต</dt>
        <dd>
          {entry.credits || "-"}
        </dd>
        <dt className="text-slate-500">เวลา</dt>
        <dd>
          วัน{tt.days[entry.day]} คาบ {entry.start}
          {entry.length > 1 ? `–${entry.start + entry.length - 1}` : ""} ({p1?.start}–{p2?.end})
        </dd>
        <dt className="text-slate-500">ผู้สอน</dt>
        <dd>
          {entry.teachers.join(", ") || <Badge tone="warn">ยังไม่มี</Badge>}
          {entry.coteach && <span className="ml-1 text-xs text-slate-500">(สอนร่วม)</span>}
        </dd>
        <dt className="text-slate-500">กลุ่มเรียน</dt>
        <dd>{entry.group_label || entry.groups.join(", ")}</dd>
        <dt className="text-slate-500">ห้องเรียน</dt>
        <dd>{entry.room ?? <Badge tone="warn">ยังไม่มี</Badge>}</dd>
        {usesField && (
          <>
            <dt className="text-slate-500">โรงยิม/สนาม</dt>
            <dd>{entry.field ?? <Badge tone="warn">ยังไม่มี</Badge>}</dd>
          </>
        )}
        <dt className="text-slate-500">สถานะ</dt>
        <dd className="flex flex-wrap gap-1">
          {entry.locked ? <Badge tone="info">ล็อกไว้</Badge> : <Badge tone="muted">ไม่ได้ล็อก</Badge>}
          {entry.kind === "combined" && <Badge tone="ok">เรียนรวม</Badge>}
          {entry.kind === "elective" && <Badge tone="info">วิชาเลือก</Badge>}
          {entry.kind === "free" && <Badge tone="purple">เลือกเสรี</Badge>}
        </dd>
      </dl>

      <div className="rounded-xl border border-slate-200 p-4">
        <h3 className="mb-1 text-sm font-semibold text-slate-700">ย้ายเวลา</h3>
        <p className="mb-3 text-xs text-slate-500">✓ = วางได้ · บนคอมพิวเตอร์ลากวิชาในตารางได้เลย</p>
        <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="เลือกวันและคาบ">
          {tt.days.map((d, di) => (
            <div key={d} className="min-w-0">
              <div className="mb-1 truncate text-center text-xs font-semibold text-slate-600">{d}</div>
              <div className="space-y-1">
                {tt.periods
                  .filter((p) => slotMap.has(`${di}-${p.no}`) || !moves)
                  .map((p) => {
                    const s = slotMap.get(`${di}-${p.no}`);
                    const chosen = day === di && start === p.no;
                    return (
                      <button
                        key={p.no}
                        type="button"
                        role="radio"
                        aria-checked={chosen}
                        disabled={!s || (!s.ok && !s.current)}
                        title={s?.ok ? "วางได้" : s?.reason}
                        onClick={() => {
                          setDay(di);
                          setStart(p.no);
                        }}
                        className={`flex min-h-8 w-full cursor-pointer items-center justify-center gap-1 rounded-md border text-xs transition disabled:cursor-not-allowed ${
                          chosen
                            ? "border-indigo-600 bg-indigo-600 text-white"
                            : s?.current
                              ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                              : s?.ok
                                ? "border-green-300 bg-green-50 text-green-800 hover:bg-green-100"
                                : "border-slate-100 bg-slate-50 text-slate-300"
                        }`}
                      >
                        {s?.ok && !chosen && !s.current && <span aria-hidden="true">✓</span>}
                        {p.no}
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
        {!moves && <p className="mt-2 text-xs text-slate-400">กำลังตรวจช่องที่วางได้…</p>}
        {linked && <p className="mt-2 text-xs text-slate-500">วิชาในกลุ่มนี้ต้องเรียนพร้อมกัน จะย้ายไปด้วยกันทั้งกลุ่ม</p>}

        <h3 className="mt-4 mb-2 text-sm font-semibold text-slate-700">เปลี่ยนสถานที่</h3>
        <div className={`grid gap-3 ${usesField ? "sm:grid-cols-2" : ""}`}>
          <label className="block">
            <span className="label">ห้องเรียน</span>
            <select className="input" value={room} onChange={(e) => setRoom(e.target.value)}>
              <option value="">— ไม่ระบุ —</option>
              {roomOptions.map((r) => (
                <option key={r.id} value={r.name}>
                  {r.name} ({r.capacity} คน)
                </option>
              ))}
            </select>
          </label>
          {usesField && (
            <label className="block">
              <span className="label">โรงยิม/สนาม</span>
              <select className="input" value={fieldName} onChange={(e) => setFieldName(e.target.value)}>
                <option value="">— ไม่ระบุ —</option>
                {fieldOptions.map((r) => (
                  <option key={r.id} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
    </Modal>
  );
}
