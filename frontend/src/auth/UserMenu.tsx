import { useState } from "react";
import Modal from "../components/Modal";
import { useAuth } from "./AuthContext";
import PasswordForm from "./PasswordForm";

export default function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return (
    <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
      <span className="flex min-w-0 items-center gap-1.5 text-sm text-slate-600" title={`${user.display_name} (${user.role_label})`}>
        <span aria-hidden="true">👤</span>
        <span className="hidden max-w-[16rem] truncate sm:inline">{user.display_name}</span>
        <span className="badge badge-info">{user.role_label}</span>
      </span>
      <button type="button" className="btn btn-ghost px-3" onClick={() => setOpen(true)} aria-label="เปลี่ยนรหัสผ่าน">
        <span className="sm:hidden" aria-hidden="true">
          🔑
        </span>
        <span className="hidden sm:inline">เปลี่ยนรหัสผ่าน</span>
      </button>
      <button type="button" className="btn btn-ghost px-3" onClick={logout}>
        ออกจากระบบ
      </button>
      <Modal open={open} title="เปลี่ยนรหัสผ่าน" onClose={() => setOpen(false)}>
        <PasswordForm />
      </Modal>
    </div>
  );
}
