import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const NAV = [
  { to: "/admin/business-development", label: "Business Development" },
  { to: "/admin/profiles", label: "Employee Profiles" },
  { to: "/admin/payslips", label: "Payslips" },
  { to: "/admin/leave", label: "Leave" },
  { to: "/admin/holidays", label: "Holidays" },
  { to: "/admin/reimbursements", label: "Reimbursements" },
  { to: "/admin/attendance", label: "Attendance" },
  { to: "/admin/documents", label: "Company Documents" },
  { to: "/admin/form22", label: "Statutory Register" },
  { to: "/admin/settings", label: "Settings" },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>HR &amp; Payroll</h1>
        <nav>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "active" : "")}>
              {item.label}
            </NavLink>
          ))}
          <div style={{ borderTop: "1px solid #1f2937", marginTop: 12, paddingTop: 12 }}>
            <span style={{ display: "block", padding: "6px 20px", fontSize: 12 }}>{user?.name} ({user?.role})</span>
            <button onClick={logout}>Log out</button>
          </div>
        </nav>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
