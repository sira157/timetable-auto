import { useEffect, useRef, type ReactNode } from "react";
import { IconX } from "./Icons";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

/** โมดัลตามข้อ 6 ของ style guide: มือถือติดล่าง, จอกว้างอยู่กลาง, Esc / คลิกนอกกรอบเพื่อปิด */
export default function Modal({ open, title, onClose, children, footer, wide }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  // เก็บ onClose ไว้ใน ref: ผู้เรียกมักส่งฟังก์ชันใหม่ทุกครั้งที่ render
  // ถ้าใส่ใน dependency จะโฟกัสกรอบใหม่ทุกครั้งที่พิมพ์ ช่องกรอกจึงพิมพ์ได้ทีละตัว
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl outline-none sm:rounded-2xl ${
          wide ? "sm:max-w-3xl" : "sm:max-w-lg"
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <h2 className="font-bold text-slate-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="ปิด"
          >
            <IconX />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
