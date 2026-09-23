import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useFeatureFlags } from "../context/FeatureFlagsContext";

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
      { to: "/admin/associates", label: "Associate Profiles" },
      { to: "/admin/attendance", label: "Attendance" },
      { to: "/admin/leave", label: "Leave Management" },
      { to: "/admin/holidays", label: "Holidays" },
      { to: "/admin/reimbursements", label: "Reimbursements" },
      { to: "/admin/payslips", label: "Payslips" },
      { to: "/admin/material-indents", label: "Material Indents" },
      { to: "/admin/company-wallet", label: "Company Wallet" },
      { to: "/admin/travel", label: "Travel" },
      { to: "/admin/documents", label: "Compliance" },
      { to: "/admin/settings", label: "Settings" },
    ],
  },
];

// A Team Lead only ever needs these two pages — approving their
// department's leave and reimbursements. Everything else is hidden from
// the nav (and StaffOnly blocks the routes directly too, see App.jsx).
const TEAM_LEAD_PATHS = ["/admin/leave", "/admin/reimbursements"];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const { flags } = useFeatureFlags();
  const isTeamLead = user?.role === "team_lead";
  const visibleGroups = NAV_GROUPS
    .filter((group) => group.label !== "PM" || (flags.projectManagement && !isTeamLead))
    .map((group) => (isTeamLead ? { ...group, items: group.items.filter((item) => TEAM_LEAD_PATHS.includes(item.to)) } : group))
    .filter((group) => group.items.length > 0);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.jpeg" alt="EHSC" className="brand-logo" />
          <h1>EHSC</h1>
        </div>
        <nav>
          {visibleGroups.map((group) => (
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
            <button className="btn-logout" onClick={logout}>Log out</button>
          </div>
        </nav>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
