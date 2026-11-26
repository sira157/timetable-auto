// โลโก้และภาพประกอบ (SVG ในตัว ไม่โหลดรูปจากภายนอก)
import { useId } from "react";

/** โลโก้: ปฏิทินที่มีช่องตารางสอนและเครื่องหมายถูก (จัดให้อัตโนมัติ) */
export function LogoMark({ size = 36, className = "" }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} role="img" aria-label="โลโก้ระบบจัดตารางสอนอัตโนมัติ">
      <defs>
        <linearGradient id={`lg-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill={`url(#lg-${id})`} />
      <rect x="9" y="12" width="30" height="26" rx="5" fill="#fff" />
      <rect x="9" y="12" width="30" height="7" rx="5" fill="#e0e7ff" />
      <rect x="9" y="16" width="30" height="3" fill="#e0e7ff" />
      <rect x="15" y="8.5" width="3" height="7" rx="1.5" fill="#fff" />
      <rect x="30" y="8.5" width="3" height="7" rx="1.5" fill="#fff" />
      <rect x="13" y="22.5" width="6" height="4" rx="1.2" fill="#38bdf8" />
      <rect x="21" y="22.5" width="6" height="4" rx="1.2" fill="#4ade80" />
      <rect x="29" y="22.5" width="6" height="4" rx="1.2" fill="#a5b4fc" />
      <rect x="13" y="29" width="6" height="4" rx="1.2" fill="#a5b4fc" />
      <rect x="21" y="29" width="6" height="4" rx="1.2" fill="#fcd34d" />
      <circle cx="35.5" cy="34.5" r="7" fill="#22c55e" stroke="#fff" strokeWidth="2.5" />
      <path d="m32.4 34.6 2.2 2.2 4-4.2" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** ภาพตารางสอน: วัน x คาบ มีบล็อกวิชาสีตามประเภท และแถบพักกลางวัน */
export function TimetableArt({ className = "" }: { className?: string }) {
  const days = ["จ", "อ", "พ", "พฤ", "ศ"];
  const blocks: [number, number, number, string][] = [
    // [วัน, เริ่มคาบ, จำนวนคาบ, สี]
    [0, 0, 2, "#bae6fd"], [0, 5, 3, "#bbf7d0"],
    [1, 1, 2, "#c7d2fe"], [1, 5, 2, "#bae6fd"],
    [2, 0, 3, "#bae6fd"], [2, 6, 2, "#ddd6fe"],
    [3, 2, 2, "#bbf7d0"], [3, 5, 3, "#c7d2fe"],
    [4, 0, 2, "#c7d2fe"], [4, 5, 4, "#bae6fd"],
  ];
  const x0 = 34;
  const cw = 26;
  const y0 = 30;
  const rh = 22;
  return (
    <svg viewBox="0 0 300 160" className={className} aria-hidden="true">
      <rect x="4" y="4" width="292" height="152" rx="14" fill="#fff" stroke="#e2e8f0" />
      <circle cx="18" cy="16" r="3" fill="#fca5a5" />
      <circle cx="28" cy="16" r="3" fill="#fcd34d" />
      <circle cx="38" cy="16" r="3" fill="#86efac" />
      {Array.from({ length: 9 }, (_, i) => (
        <text key={i} x={x0 + i * cw + cw / 2} y={y0 - 5} fontSize="7" textAnchor="middle" fill="#94a3b8">
          {i + 1}
        </text>
      ))}
      {days.map((d, i) => (
        <g key={d}>
          <text x="20" y={y0 + i * rh + 14} fontSize="8" textAnchor="middle" fill="#475569" fontWeight="600">
            {d}
          </text>
          <line x1={x0} x2={x0 + 9 * cw} y1={y0 + i * rh} y2={y0 + i * rh} stroke="#f1f5f9" />
        </g>
      ))}
      <rect x={x0 + 4 * cw + 2} y={y0 + 2} width={cw - 4} height={5 * rh - 4} rx="4" fill="#fef3c7" stroke="#fde68a" />
      <text x={x0 + 4 * cw + cw / 2} y={y0 + 2.5 * rh + 3} fontSize="6.5" textAnchor="middle" fill="#b45309" transform={`rotate(-90 ${x0 + 4 * cw + cw / 2} ${y0 + 2.5 * rh})`}>
        พักกลางวัน
      </text>
      {blocks.map(([d, s, l, c], i) => (
        <rect key={i} x={x0 + s * cw + 2} y={y0 + d * rh + 3} width={l * cw - 4} height={rh - 6} rx="4" fill={c} />
      ))}
      <g transform="translate(246 118)">
        <circle r="15" fill="#22c55e" />
        <path d="m-6 0 4 4 8-8" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/** ภาพไฟล์ Excel ข้อมูลหลักสูตร: หัวคอลัมน์และแท็บชีตที่ต้องมี */
export function WorkbookArt({ className = "" }: { className?: string }) {
  const cols = ["กลุ่มเรียน", "รหัสวิชา", "ชื่อรายวิชา", "อาจารย์", "สถานที่", "หน่วยกิต"];
  const tabs = ["ชั้นปีที่1", "ชั้นปีที่2", "ชั้นปีที่3", "ชั้นปีที่4", "ฝ่ายบริหาร", "สถานที่เรียน"];
  return (
    <svg viewBox="0 0 320 150" className={className} role="img" aria-label="ตัวอย่างไฟล์ Excel ข้อมูลหลักสูตร มีชีตชั้นปีที่ 1 ถึง 4 ฝ่ายบริหาร และสถานที่เรียน">
      <rect x="2" y="2" width="316" height="146" rx="12" fill="#fff" stroke="#cbd5e1" />
      <rect x="2" y="2" width="316" height="20" rx="12" fill="#16a34a" />
      <rect x="2" y="12" width="316" height="10" fill="#16a34a" />
      <text x="14" y="16" fontSize="9" fill="#fff" fontWeight="700">
        X
      </text>
      <text x="26" y="16" fontSize="8" fill="#fff">
        ข้อมูลหลักสูตร.xlsx
      </text>
      {cols.map((c, i) => (
        <g key={c}>
          <rect x={10 + i * 50} y="28" width="49" height="14" fill="#eef2ff" stroke="#c7d2fe" />
          <text x={34.5 + i * 50} y="38" fontSize="6.5" textAnchor="middle" fill="#3730a3" fontWeight="600">
            {c}
          </text>
        </g>
      ))}
      {[0, 1, 2, 3, 4].map((r) => (
        <g key={r}>
          {cols.map((_, i) => (
            <rect key={i} x={10 + i * 50} y={42 + r * 14} width="49" height="14" fill={r % 2 ? "#f8fafc" : "#fff"} stroke="#e2e8f0" />
          ))}
          <rect x={64} y={47 + r * 14} width={26 + ((r * 7) % 14)} height="4" rx="2" fill="#94a3b8" />
          <rect x={114} y={47 + r * 14} width={34 - ((r * 5) % 12)} height="4" rx="2" fill="#cbd5e1" />
          <rect x={164} y={47 + r * 14} width={30} height="4" rx="2" fill="#cbd5e1" />
          <rect x={214} y={47 + r * 14} width={22 + ((r * 3) % 16)} height="4" rx="2" fill="#bae6fd" />
          <rect x={264} y={47 + r * 14} width="22" height="4" rx="2" fill="#c7d2fe" />
        </g>
      ))}
      <text x="34.5" y="52" fontSize="6.5" textAnchor="middle" fill="#334155">
        ปีที่ 1/1
      </text>
      {tabs.map((t, i) => (
        <g key={t}>
          <rect x={8 + i * 51} y="118" width="49" height="16" rx="4" fill={i === 0 ? "#fff" : "#f1f5f9"} stroke={i === 0 ? "#16a34a" : "#e2e8f0"} />
          <text x={32.5 + i * 51} y="129" fontSize="6.5" textAnchor="middle" fill={i === 0 ? "#15803d" : "#475569"} fontWeight={i === 0 ? 700 : 500}>
            {t}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** ขั้นตอนการคำนวณ: ข้อมูล → ตัดเวลาที่ห้าม → CP-SAT → ตรวจทุกคาบ → ตาราง */
export function PipelineArt({ className = "" }: { className?: string }) {
  const steps = [
    { label: "ข้อมูล", color: "#e0e7ff", ink: "#4338ca", icon: "M-6 -5h12M-6 0h12M-6 5h8" },
    { label: "ตัดเวลาห้าม", color: "#fef3c7", ink: "#b45309", icon: "M-6 -6 6 6M6 -6 -6 6" },
    { label: "CP-SAT", color: "#ede9fe", ink: "#6d28d9", icon: "M1 -7-5 1h5l-2 7 7-9H1Z" },
    { label: "ตรวจทุกคาบ", color: "#dcfce7", ink: "#15803d", icon: "m-6 0 4 4 8-8" },
    { label: "ตาราง", color: "#e0f2fe", ink: "#0369a1", icon: "M-7 -6h14v12h-14ZM-7 -1h14M-2 -6v12" },
  ];
  return (
    <svg viewBox="0 0 330 64" className={className} role="img" aria-label="ขั้นตอน: ข้อมูล ตัดเวลาที่ห้ามจัด คำนวณด้วย CP-SAT ตรวจทุกคาบ ได้ตาราง">
      {steps.map((s, i) => {
        const cx = 33 + i * 66;
        return (
          <g key={s.label}>
            {i > 0 && (
              <g>
                <line x1={cx - 50} x2={cx - 20} y1="24" y2="24" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="3 3" />
                <path d={`M${cx - 23} 20 l4 4 -4 4`} fill="none" stroke="#94a3b8" strokeWidth="2" />
              </g>
            )}
            <circle cx={cx} cy="24" r="17" fill={s.color} />
            <path d={s.icon} transform={`translate(${cx} 24)`} fill="none" stroke={s.ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <text x={cx} y="57" fontSize="9" textAnchor="middle" fill="#475569" fontWeight="600">
              {s.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
