import { useEffect, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { NavLink, useLocation } from "react-router-dom";
import UserMenu from "../auth/UserMenu";
import { IconArrowDown, IconBolt, IconCheck, IconChevron, IconDoc, IconHome, IconMenu, IconTable, IconX } from "./Icons";
import { LogoMark } from "./Illustrations";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const STEPS: { to: string; label: string; icon: Icon }[] = [
  { to: "/import", label: "นำเข้าข้อมูล", icon: IconArrowDown },
  { to: "/check", label: "ตรวจสอบข้อมูล", icon: IconCheck },
  { to: "/run", label: "จัดตาราง", icon: IconBolt },
  { to: "/timetable", label: "ตารางสอน", icon: IconTable },
  { to: "/reports", label: "รายงาน / ส่งออก", icon: IconDoc },
];

const GROUPS: { key: string; title: string; items: { to: string; label: string }[] }[] = [
  {
    key: "data",
    title: "ข้อมูลพื้นฐาน",
    items: [
      { to: "/data/teachers", label: "อาจารย์" },
      { to: "/data/courses", label: "รายวิชา" },
      { to: "/data/groups", label: "กลุ่มเรียน" },
      { to: "/data/rooms", label: "ห้องเรียน" },
      { to: "/data/buildings", label: "อาคาร" },
      { to: "/data/combined", label: "เรียนรวม" },
      { to: "/data/coteach", label: "สอนร่วม" },
      { to: "/data/busy", label: "เวลาที่ไม่ว่าง" },
      { to: "/data/unregistered", label: "ข้อมูลไม่ลงทะเบียน" },
    ],
  },
  {
    key: "system",
    title: "ระบบ",
    items: [
      { to: "/system/settings", label: "ตั้งค่าเงื่อนไข" },
      { to: "/system/users", label: "บัญชีผู้ใช้" },
      { to: "/system/backup", label: "สำรองและล้างข้อมูล" },
      { to: "/system/changes", label: "ประวัติการแก้ไข" },
      { to: "/system/runs", label: "ประวัติการประมวลผล" },
    ],
  },
];

function itemClass(active: boolean) {
  return `group relative flex min-h-10 items-center gap-2.5 rounded-lg px-2 py-2.5 text-sm transition ${
    active ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-100"
  }`;
}

function ActiveBar({ active }: { active: boolean }) {
  return active ? <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-brand-600" aria-hidden="true" /> : null;
}

function MainItem({ to, label, icon: Ico, num, onNavigate }: { to: string; label: string; icon: Icon; num?: number; onNavigate: () => void }) {
  return (
    <NavLink to={to} end={to === "/"} onClick={onNavigate} className={({ isActive }) => itemClass(isActive)}>
      {({ isActive }) => (
        <>
          <ActiveBar active={isActive} />
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
              isActive ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500"
            }`}
          >
            <Ico width={16} height={16} />
          </span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {num !== undefined && <span className={`text-xs tabular-nums ${isActive ? "text-brand-400" : "text-slate-300"}`}>{num}</span>}
        </>
      )}
    </NavLink>
  );
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={38} className="shrink-0 drop-shadow-[0_4px_8px_rgba(99,102,241,0.25)]" />
      <div className="leading-tight">
        <div className="text-[15px] font-bold text-slate-800">ระบบจัดตารางสอน</div>
        <div className="text-xs text-brand-600">อัตโนมัติ</div>
      </div>
    </div>
  );
}

function SideNav({ onNavigate }: { onNavigate: () => void }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({
    data: pathname.startsWith("/data"),
    system: pathname.startsWith("/system"),
  }));
  useEffect(() => {
    if (pathname.startsWith("/data")) setOpen((o) => ({ ...o, data: true }));
    if (pathname.startsWith("/system")) setOpen((o) => ({ ...o, system: true }));
  }, [pathname]);

  return (
    <nav className="space-y-5" aria-label="เมนูหลัก">
      <div className="space-y-1">
        <MainItem to="/" label="หน้าแรก" icon={IconHome} onNavigate={onNavigate} />
      </div>
      <div>
        <div className="mb-1.5 px-2 text-xs font-medium text-slate-400">ขั้นตอนการทำงาน</div>
        <div className="space-y-1">
          {STEPS.map((s, i) => (
            <MainItem key={s.to} {...s} num={i + 1} onNavigate={onNavigate} />
          ))}
        </div>
      </div>
      {GROUPS.map((g) => (
        <div key={g.key}>
          <button
            type="button"
            className="flex min-h-10 w-full cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-bold text-slate-400 hover:text-slate-600"
            aria-expanded={open[g.key]}
            onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}
          >
            <IconChevron width={14} height={14} className={`transition-transform ${open[g.key] ? "rotate-90" : ""}`} />
            {g.title}
          </button>
          {open[g.key] && (
            <div className="mt-0.5 space-y-0.5">
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} onClick={onNavigate} className={({ isActive }) => `${itemClass(isActive)} pl-4`}>
                  {({ isActive }) => (
                    <>
                      <ActiveBar active={isActive} />
                      <span className="truncate">{it.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

function Header({ onMenu, menuOpen, showMenuButton }: { onMenu?: () => void; menuOpen?: boolean; showMenuButton: boolean }) {
  return (
    <header className="no-print sticky top-0 z-30 border-b border-brand-100 bg-white/80 backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-2 px-4 md:px-8">
        <div className="flex min-w-0 items-center gap-2">
          {showMenuButton && (
            <button
              type="button"
              className="btn btn-ghost w-10 px-0 md:hidden"
              onClick={onMenu}
              aria-label={menuOpen ? "ปิดเมนู" : "เปิดเมนู"}
              aria-expanded={menuOpen}
            >
              {menuOpen ? <IconX /> : <IconMenu />}
            </button>
          )}
          <div className={showMenuButton ? "md:hidden" : ""}>
            <span className="hidden min-[420px]:block">
              <Logo />
            </span>
          </div>
        </div>
        <UserMenu />
      </div>
    </header>
  );
}

function Content({ children, wide }: { children: ReactNode; wide?: boolean }) {
  // หน้าตารางสอนใช้ความกว้างเต็มพื้นที่ เพื่อให้เห็นตารางครบโดยไม่ต้องเลื่อน
  return <main className={`mx-auto w-full min-w-0 px-4 py-6 md:px-6 ${wide ? "max-w-none xl:px-8" : "max-w-6xl md:px-8"}`}>{children}</main>;
}

export default function Layout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r border-brand-100 bg-white/90 px-3 py-4 backdrop-blur md:block">
        <div className="mb-5 px-1">
          <Logo />
        </div>
        <SideNav onNavigate={() => undefined} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Header showMenuButton onMenu={() => setMobileOpen((o) => !o)} menuOpen={mobileOpen} />
        {mobileOpen && (
          <div className="no-print border-b border-slate-200 bg-white px-4 py-4 md:hidden">
            <SideNav onNavigate={() => setMobileOpen(false)} />
          </div>
        )}
        <Content wide={pathname.startsWith("/timetable")}>{children}</Content>
      </div>
    </div>
  );
}

/** โครงหน้าสำหรับอาจารย์/นักเรียน (ไม่มีแถบเมนู เพราะเข้าได้เฉพาะตารางของตนเอง) */
export function SimpleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header showMenuButton={false} />
      <Content wide>{children}</Content>
    </div>
  );
}
