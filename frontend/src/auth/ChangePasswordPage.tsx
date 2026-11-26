import { useAuth } from "./AuthContext";
import { AuthCard } from "./Login";
import PasswordForm from "./PasswordForm";

export default function ChangePasswordPage() {
  const { user, logout } = useAuth();
  return (
    <AuthCard subtitle="ตั้งรหัสผ่านใหม่ก่อนใช้งาน">
      <p className="mb-4 rounded-xl bg-indigo-50 px-3 py-2.5 text-sm text-indigo-800">
        สวัสดี {user?.display_name} — กรุณาเปลี่ยนรหัสผ่านที่ได้รับเป็นรหัสผ่านของคุณเอง (อย่างน้อย 6 ตัวอักษร)
      </p>
      <PasswordForm
        extraActions={
          <button type="button" className="btn btn-ghost" onClick={logout}>
            ออกจากระบบ
          </button>
        }
      />
    </AuthCard>
  );
}
