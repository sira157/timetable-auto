import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import ChangePasswordPage from "./auth/ChangePasswordPage";
import Login from "./auth/Login";
import Layout, { SimpleLayout } from "./components/Layout";
import { Spinner } from "./components/ui";
import Dashboard from "./pages/Dashboard";
import {
  BuildingsPage,
  BusyPage,
  CoTeachPage,
  CombinedPage,
  CoursesPage,
  GroupsPage,
  RoomsPage,
  TeachersPage,
  UnregisteredPage,
} from "./pages/DataPages";
import ManualEntryPage from "./pages/ManualEntry";
import MyTimetable from "./pages/MyTimetable";
import ReportsPage from "./pages/ReportsPage";
import { BackupPage, ChangesPage, RunsPage, SettingsPage, UsersPage } from "./pages/SystemPages";
import TimetablePage from "./pages/TimetablePage";
import { CheckPage, ImportPage, RunPage } from "./pages/Workflow";

export default function App() {
  const { user, loading } = useAuth();

  // ไม่แสดงหน้าใดจนกว่าจะตรวจโทเคนเสร็จ
  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="กำลังตรวจสอบการเข้าสู่ระบบ…" />
      </div>
    );
  if (!user) return <Login />;
  if (user.must_change_password) return <ChangePasswordPage />;

  if (user.role !== "staff") {
    return (
      <SimpleLayout>
        <Routes>
          <Route path="*" element={<MyTimetable />} />
        </Routes>
      </SimpleLayout>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/check" element={<CheckPage />} />
        <Route path="/run" element={<RunPage />} />
        <Route path="/timetable" element={<TimetablePage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/import/manual" element={<ManualEntryPage />} />
        <Route path="/data/manual" element={<Navigate to="/import/manual" replace />} />
        <Route path="/data/teachers" element={<TeachersPage />} />
        <Route path="/data/courses" element={<CoursesPage />} />
        <Route path="/data/groups" element={<GroupsPage />} />
        <Route path="/data/rooms" element={<RoomsPage />} />
        <Route path="/data/buildings" element={<BuildingsPage />} />
        <Route path="/data/combined" element={<CombinedPage />} />
        <Route path="/data/coteach" element={<CoTeachPage />} />
        <Route path="/data/busy" element={<BusyPage />} />
        <Route path="/data/unregistered" element={<UnregisteredPage />} />
        <Route path="/system/settings" element={<SettingsPage />} />
        <Route path="/system/users" element={<UsersPage />} />
        <Route path="/system/backup" element={<BackupPage />} />
        <Route path="/system/changes" element={<ChangesPage />} />
        <Route path="/system/runs" element={<RunsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
