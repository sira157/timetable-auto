import { useState, type FormEvent, type ReactNode } from "react";
import { MIN_PASSWORD_LENGTH, useAuth } from "./AuthContext";

/** ฟอร์ม 3 ช่องสำหรับเปลี่ยนรหัสผ่าน ใช้ทั้งหน้าบังคับเปลี่ยนและโมดัลในเมนูผู้ใช้ */
export default function PasswordForm({ onDone, extraActions }: { onDone?: () => void; extraActions?: ReactNode }) {
  const { changePassword } = useAuth();
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && newPw !== confirm;
  const tooShort = newPw.length > 0 && newPw.length < MIN_PASSWORD_LENGTH;
  const canSubmit = oldPw && newPw.length >= MIN_PASSWORD_LENGTH && newPw === confirm && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      await changePassword(oldPw, newPw);
      setDone(true);
      setOldPw("");
      setNewPw("");
      setConfirm("");
      onDone?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="label">รหัสผ่านปัจจุบัน</span>
        <input className="input" type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">รหัสผ่านใหม่</span>
        <input className="input" type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
        {tooShort && <span className="mt-1 block text-xs text-amber-700">ต้องมีอย่างน้อย {MIN_PASSWORD_LENGTH} ตัวอักษร</span>}
      </label>
      <label className="block">
        <span className="label">รหัสผ่านใหม่อีกครั้ง</span>
        <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      {mismatch && <p className="text-sm text-red-600">รหัสผ่านใหม่ไม่ตรงกัน</p>}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {done && !error && <p className="text-sm text-green-700">เปลี่ยนรหัสผ่านแล้ว</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary flex-1" disabled={!canSubmit}>
          {busy ? "กำลังบันทึก…" : "เปลี่ยนรหัสผ่าน"}
        </button>
        {extraActions}
      </div>
    </form>
  );
}
