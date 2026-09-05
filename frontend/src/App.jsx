import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";

import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";

import AdminLayout from "./layouts/AdminLayout";
import BusinessDevelopment from "./pages/Admin/BusinessDevelopment";
import CompanyProfiles from "./pages/Admin/CompanyProfiles";
import EmployeeProfiles from "./pages/Admin/EmployeeProfiles";
import Payslips from "./pages/Admin/Payslips";
import Leave from "./pages/Admin/Leave";
import Holidays from "./pages/Admin/Holidays";
import Reimbursements from "./pages/Admin/Reimbursements";
import Attendance from "./pages/Admin/Attendance";
import CompanyDocuments from "./pages/Admin/CompanyDocuments";
import Form22 from "./pages/Admin/Form22";
import Settings from "./pages/Admin/Settings";

import EmployeeLayout from "./layouts/EmployeeLayout";
import Hub from "./pages/Employee/Hub";
import MyLeave from "./pages/Employee/MyLeave";
import MyReimbursements from "./pages/Employee/MyReimbursements";
import MyAttendance from "./pages/Employee/MyAttendance";
import MyProfile from "./pages/Employee/MyProfile";
import MyDocuments from "./pages/Employee/MyDocuments";
import MyPayslips from "./pages/Employee/MyPayslips";
import MyActivity from "./pages/Employee/MyActivity";

function RequireAuth({ children, role }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustReset) return <Navigate to="/change-password" replace />;
  if (role === "admin" && !["admin", "superadmin"].includes(user.role)) return <Navigate to="/me" replace />;
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
        <Route index element={<Navigate to="business-development" replace />} />
        <Route path="business-development" element={<BusinessDevelopment />} />
        <Route path="company-profiles" element={<CompanyProfiles />} />
        <Route path="profiles" element={<EmployeeProfiles />} />
        <Route path="payslips" element={<Payslips />} />
        <Route path="leave" element={<Leave />} />
        <Route path="holidays" element={<Holidays />} />
        <Route path="reimbursements" element={<Reimbursements />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="documents" element={<CompanyDocuments />} />
        <Route path="form22" element={<Form22 />} />
        <Route path="settings" element={<Settings />} />
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
        <Route path="attendance" element={<MyAttendance />} />
        <Route path="profile" element={<MyProfile />} />
        <Route path="documents" element={<MyDocuments />} />
        <Route path="payslips" element={<MyPayslips />} />
        <Route path="activity" element={<MyActivity />} />
      </Route>

      <Route
        path="/"
        element={
          user ? (
            <Navigate to={["admin", "superadmin"].includes(user.role) ? "/admin" : "/me"} replace />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
