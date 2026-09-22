import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { useFeatureFlags } from "./context/FeatureFlagsContext";

import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";

import AdminLayout from "./layouts/AdminLayout";
import BusinessDevelopment from "./pages/Admin/BusinessDevelopment";
import CompanyProfiles from "./pages/Admin/CompanyProfiles";
import ProjectTracker from "./pages/Admin/ProjectTracker";
import EmployeeProfiles from "./pages/Admin/EmployeeProfiles";
import Payslips from "./pages/Admin/Payslips";
import Leave from "./pages/Admin/Leave";
import Holidays from "./pages/Admin/Holidays";
import Reimbursements from "./pages/Admin/Reimbursements";
import Attendance from "./pages/Admin/Attendance";
import CompanyDocuments from "./pages/Admin/CompanyDocuments";
import Travel from "./pages/Admin/Travel";
import Settings from "./pages/Admin/Settings";
import MaterialIndents from "./pages/Admin/MaterialIndents";

import EmployeeLayout from "./layouts/EmployeeLayout";
import Hub from "./pages/Employee/Hub";
import MyLeave from "./pages/Employee/MyLeave";
import MyReimbursements from "./pages/Employee/MyReimbursements";
import MyAttendance from "./pages/Employee/MyAttendance";
import MyProfile from "./pages/Employee/MyProfile";
import MyProjectTracker from "./pages/Employee/MyProjectTracker";
import MyDocuments from "./pages/Employee/MyDocuments";
import MyPayslips from "./pages/Employee/MyPayslips";
import MyActivity from "./pages/Employee/MyActivity";
import MyMaterialIndents from "./pages/Employee/MyMaterialIndents";
import MyTravel from "./pages/Employee/MyTravel";

function RequireAuth({ children, role }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustReset) return <Navigate to="/change-password" replace />;
  // A Team Lead uses the admin-style layout too (just for Leave and
  // Reimbursements — see StaffOnly below), not the employee self-service one.
  if (role === "admin" && !["admin", "superadmin", "team_lead"].includes(user.role)) return <Navigate to="/me" replace />;
  return children;
}

// Guards the admin pages a Team Lead should NOT reach (everything except
// Leave and Reimbursements) — sends them back to the one page they're sure
// to have access to instead of a broken/empty page full of 403s.
function StaffOnly({ children }) {
  const { user } = useAuth();
  if (user.role === "team_lead") return <Navigate to="/admin/leave" replace />;
  return children;
}

// Guards a route behind a feature flag — used for the PM suite, which
// ships disabled for the HR/Payroll go-live. Shows a plain notice instead
// of redirecting, so a bookmarked/typed URL doesn't just bounce silently.
function RequireFeature({ flag, children }) {
  const { flags, loading } = useFeatureFlags();
  if (loading) return null;
  if (!flags[flag]) {
    return (
      <div className="card">
        <h3 className="mt-0">This module is currently disabled</h3>
        <p className="hint-text mt-0">An admin can turn it back on from Settings → Feature Flags.</p>
      </div>
    );
  }
  return children;
}

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route
        path="/change-password"
        element={user ? <ChangePassword /> : <Navigate to="/login" replace />}
      />

      <Route
        path="/admin"
        element={
          <RequireAuth role="admin">
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to={user?.role === "team_lead" ? "leave" : "profiles"} replace />} />
        <Route path="business-development" element={<StaffOnly><RequireFeature flag="projectManagement"><BusinessDevelopment /></RequireFeature></StaffOnly>} />
        <Route path="company-profiles" element={<StaffOnly><RequireFeature flag="projectManagement"><CompanyProfiles /></RequireFeature></StaffOnly>} />
        <Route path="project-tracker" element={<StaffOnly><RequireFeature flag="projectManagement"><ProjectTracker /></RequireFeature></StaffOnly>} />
        <Route path="profiles" element={<StaffOnly><EmployeeProfiles kind="staff" /></StaffOnly>} />
        <Route path="associates" element={<StaffOnly><EmployeeProfiles kind="associate" /></StaffOnly>} />
        <Route path="payslips" element={<StaffOnly><Payslips /></StaffOnly>} />
        <Route path="leave" element={<Leave />} />
        <Route path="holidays" element={<StaffOnly><Holidays /></StaffOnly>} />
        <Route path="reimbursements" element={<Reimbursements />} />
        <Route path="material-indents" element={<StaffOnly><MaterialIndents /></StaffOnly>} />
        <Route path="attendance" element={<StaffOnly><Attendance /></StaffOnly>} />
        <Route path="documents" element={<StaffOnly><CompanyDocuments /></StaffOnly>} />
        <Route path="travel" element={<StaffOnly><Travel /></StaffOnly>} />
        <Route path="settings" element={<StaffOnly><Settings /></StaffOnly>} />
      </Route>

      <Route
        path="/me"
        element={
          <RequireAuth>
            <EmployeeLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Hub />} />
        <Route path="leave" element={<MyLeave />} />
        <Route path="reimbursements" element={<MyReimbursements />} />
        <Route path="material-indents" element={<MyMaterialIndents />} />
        <Route path="attendance" element={<MyAttendance />} />
        <Route path="travel" element={<MyTravel />} />
        <Route path="profile" element={<MyProfile />} />
        <Route path="project-tracker" element={<RequireFeature flag="projectManagement"><MyProjectTracker /></RequireFeature>} />
        <Route path="documents" element={<MyDocuments />} />
        <Route path="payslips" element={<MyPayslips />} />
        <Route path="activity" element={<MyActivity />} />
      </Route>

      <Route
        path="/"
        element={
          user ? (
            <Navigate to={["admin", "superadmin", "team_lead"].includes(user.role) ? "/admin" : "/me"} replace />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
