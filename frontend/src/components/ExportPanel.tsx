import { useEffect, useRef, useState } from "react";
import { api, downloadFile } from "../lib/api";
import { elementsToPdf } from "../lib/pdf";
import type { Timetable, View } from "../lib/types";
import { IconArrowDown, IconPrint } from "./Icons";
import Modal from "./Modal";
import PdfSummary from "./PdfSummary";
import TimetableGrid from "./TimetableGrid";

const REPORT_KEY: Record<View, string> = {
  group: "group_timetables",
  teacher: "teacher_timetables",
  room: "room_timetables",
  building: "room_timetables",
};

const VIEW_LABEL: Record<View, string> = { group: "ชั้นปี", teacher: "อาจารย์", room: "ห้อง/สนาม", building: "อาคาร" };

interface Props {
  versionId: number | string;
  view: View;
  current: { id: string; label: string } | null;
  all: { id: string; label: string }[];
  /** อาจารย์/นักเรียน: ส่งออกได้เฉพาะของตนเอง และไม่ส่ง version_id */
  selfOnly?: boolean;
  /** ส่งออกทุกรายการเสมอ (ไม่มีตัวเลือกขอบเขต) */
  allOnly?: boolean;
  onError: (msg: string) => void;
}

/** ส่งออกตาราง PDF / Excel / CSV และพิมพ์ */
export default function ExportPanel({ versionId, view, current, all, selfOnly, allOnly, onError }: Props) {
  const [scope, setScope] = useState<"one" | "all">(allOnly ? "all" : "one");
  const [pdf, setPdf] = useState<{ items: Timetable[]; done: number; total: number; stage: string } | null>(null);
  const stop = useRef(false);
  const holder = useRef<HTMLDivElement>(null);
  const canAll = !selfOnly && view !== "building" && all.length > 1;
  const targets = scope === "all" && canAll ? all : current ? [current] : [];
  // ชื่อไฟล์ห้ามมี / \ : * ? " < > | (เช่น "ปีที่ 1/1") ไม่เช่นนั้นเบราว์เซอร์บางตัวไม่ยอมบันทึก
  const fileBase = (scope === "all" && canAll ? `ตาราง${VIEW_LABEL[view]}ทั้งหมด` : current?.label ?? "ตาราง").replace(/[\\/:*?"<>|]+/g, "-");

  function query(fmt: string) {
    const parts = [`format=${fmt}`];
    if (!selfOnly) parts.push(`version_id=${versionId}`);
    if ((scope === "one" || !canAll) && current && view !== "building") parts.push(`id=${encodeURIComponent(current.id)}`);
    // มุมมองอาคาร: ส่งออกเฉพาะห้อง/จุดของอาคารที่เลือก
    if (view === "building" && current) parts.push(`building=${encodeURIComponent(current.id)}`);
    return `/api/reports/${REPORT_KEY[view]}?${parts.join("&")}`;
  }

  async function startPdf() {
    stop.current = false;
    setPdf({ items: [], done: 0, total: targets.length, stage: "โหลดข้อมูล" });
    try {
      const items: Timetable[] = [];
      for (const t of targets) {
        if (stop.current) throw new Error("ยกเลิกแล้ว");
        items.push(await api.get<Timetable>(`/api/schedule/versions/${versionId}/timetable?view=${view}&id=${encodeURIComponent(t.id)}`));
        setPdf({ items: [], done: items.length, total: targets.length, stage: "โหลดข้อมูล" });
      }
      setPdf({ items, done: 0, total: items.length, stage: "สร้างหน้า PDF" });
    } catch (e) {
      setPdf(null);
      if (!stop.current) onError((e as Error).message);
    }
  }

  // เมื่อวาดตารางนอกจอเสร็จ จึงจับภาพทีละหน้า
  useEffect(() => {
    if (!pdf || pdf.stage !== "สร้างหน้า PDF" || pdf.done > 0 || !holder.current) return;
    const nodes = Array.from(holder.current.querySelectorAll<HTMLElement>("[data-pdf-page]"));
    const run = async () => {
      try {
        await document.fonts?.ready;
        await elementsToPdf(
          nodes,
          `${fileBase}.pdf`,
          (done, total) => setPdf((p) => (p ? { ...p, done, total } : p)),
          () => stop.current,
        );
      } catch (e) {
        if (!stop.current) onError((e as Error).message);
      } finally {
        setPdf(null);
      }
    };
    const t = setTimeout(run, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf?.stage, pdf?.items]);

  const percent = pdf && pdf.total ? Math.round((pdf.done / pdf.total) * 100) : 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canAll && !allOnly && (
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm" role="radiogroup" aria-label="ขอบเขตการส่งออก">
          {(
            [
              ["one", "ที่เลือก"],
              ["all", `ทุก${VIEW_LABEL[view]} (${all.length})`],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={scope === k}
              onClick={() => setScope(k)}
              className={`min-h-9 cursor-pointer rounded-lg px-3 font-medium transition ${scope === k ? "bg-white text-brand-700 shadow-sm" : "text-slate-600"}`}
            >
              {l}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="btn btn-primary" disabled={!targets.length || Boolean(pdf)} onClick={startPdf}>
        <IconArrowDown /> PDF
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={!targets.length}
        onClick={() => downloadFile(query("xlsx"), `${fileBase}.xlsx`).catch((e) => onError(e.message))}
      >
        <IconArrowDown /> Excel
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={!targets.length}
        onClick={() => downloadFile(query("csv"), `${fileBase}.csv`).catch((e) => onError(e.message))}
      >
        <IconArrowDown /> CSV
      </button>
      {!allOnly && (
        <button type="button" className="btn btn-ghost" onClick={() => window.print()} title="พิมพ์ตารางที่เห็นอยู่">
          <IconPrint /> พิมพ์
        </button>
      )}

      <Modal
        open={Boolean(pdf)}
        title="กำลังสร้าง PDF"
        onClose={() => {
          stop.current = true;
          setPdf(null);
        }}
        footer={
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              stop.current = true;
              setPdf(null);
            }}
          >
            ยกเลิก
          </button>
        }
      >
        <p className="mb-2 text-sm text-slate-600">
          {pdf?.stage} {pdf?.done ?? 0}/{pdf?.total ?? 0}
        </p>
        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${percent}%` }} />
        </div>
      </Modal>
      {pdf && pdf.items.length > 0 && (
        <div ref={holder} aria-hidden="true" className="pointer-events-none fixed top-0 -left-[20000px] w-[1180px] bg-white">
          {pdf.items.map((tt, i) => (
            <div key={`${tt.id}-${i}`}>
              <div data-pdf-page data-pdf-new="1" className="pdf-full bg-white p-3">
                <TimetableGrid tt={tt} forceGrid />
              </div>
              <div data-pdf-page className="pdf-full bg-white px-3 pb-3">
                <PdfSummary tt={tt} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
