import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const NAV_GROUPS = [
  {
    label: "PM",
    items: [
      { to: "/admin/business-development", label: "Business Development" },
      { to: "/admin/company-profiles", label: "Company Profiles" },
      { to: "/admin/project-tracker", label: "Project Tracker" },
    ],
  },
  {
    label: "HR & Payroll",
    items: [
      { to: "/admin/profiles", label: "Employee Profiles" },
      { to: "/admin/payslips", label: "Payslips" },
      { to: "/admin/leave", label: "Leave" },
      { to: "/admin/holidays", label: "Holidays" },
      { to: "/admin/reimbursements", label: "Reimbursements" },
      { to: "/admin/attendance", label: "Attendance" },
      { to: "/admin/documents", label: "Company Documents" },
      { to: "/admin/form22", label: "Statutory Register" },
      { to: "/admin/settings", label: "Settings" },
    ],
  },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Project Management App</h1>
        <nav>
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group-label">{group.label}</span>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "active" : "")}>
                  {item.label}
                </NavLink>
              ))}
            </div>
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
