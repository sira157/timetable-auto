import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import ExportPanel from "../components/ExportPanel";
import { IconSearch } from "../components/Icons";
import TimetableGrid from "../components/TimetableGrid";
import { Alert, EmptyState, PageHeader, Spinner, formatDateTime, useApi, useToast } from "../components/ui";
import type { Timetable } from "../lib/types";

/** หน้าสำหรับอาจารย์/นักเรียน: ดูได้เฉพาะตารางของตนเองในตารางที่ใช้งานอยู่ */
export default function MyTimetable() {
  const { user } = useAuth();
  const active = useApi<{ id: number; name: string; created_at: string | null } | null>("/api/schedule/active");
  const view = user?.role === "teacher" ? "teacher" : "group";
  const path = active.data && user?.scope_id != null ? `/api/schedule/versions/${active.data.id}/timetable?view=${view}&id=${user.scope_id}` : null;
  const tt = useApi<Timetable>(path);
  const toast = useToast();
  const [search, setSearch] = useState("");
  const me = user?.scope_id != null ? { id: String(user.scope_id), label: tt.data?.title ?? "ตารางของฉัน" } : null;

  return (
    <div>
      <PageHeader
        title={view === "teacher" ? "ตารางสอนของฉัน" : "ตารางเรียนของกลุ่ม"}
        subtitle={active.data ? `${active.data.name} · ปรับปรุง ${formatDateTime(active.data.created_at)}` : undefined}
      />
      {tt.data && active.data && (
        <div className="no-print card mb-4 flex flex-wrap items-end justify-between gap-3 p-4">
          <label className="block w-full sm:max-w-xs">
            <span className="label">ค้นหาในตาราง</span>
            <div className="relative">
              <IconSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
              <input className="input pl-9" placeholder="รหัสวิชา ชื่อวิชา ห้อง" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </label>
          <ExportPanel versionId={active.data.id} view={view} current={me} all={me ? [me] : []} selfOnly onError={toast.error} />
        </div>
      )}
      {(active.loading || tt.loading) && <Spinner />}
      {active.error && <Alert tone="error">{active.error}</Alert>}
      {tt.error && <Alert tone="error">{tt.error}</Alert>}
      {!active.loading && !active.data && <EmptyState title="ยังไม่มีตารางที่ประกาศใช้">ติดต่อผู้ดูแลเว็บไซต์</EmptyState>}
      {tt.data && <TimetableGrid tt={tt.data} search={search} />}
      {toast.node}
    </div>
  );
}
