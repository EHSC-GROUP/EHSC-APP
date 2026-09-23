import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useFeatureFlags } from "../context/FeatureFlagsContext";

// Items with `children` render as a collapsible group instead of a direct
// link — keeps the always-visible list short even as more pages get added.
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
      {
        label: "Profiles",
        children: [
          { to: "/admin/profiles", label: "Employee Profiles" },
          { to: "/admin/associates", label: "Associate Profiles" },
        ],
      },
      { to: "/admin/attendance", label: "Attendance" },
      {
        label: "Leave Management",
        children: [
          { to: "/admin/leave", label: "Register & Balances" },
          { to: "/admin/holidays", label: "Holidays" },
        ],
      },
      {
        label: "Finance",
        children: [
          { to: "/admin/company-wallet", label: "Company Wallet" },
          { to: "/admin/reimbursements", label: "Reimbursements" },
          { to: "/admin/material-indents", label: "Material Indents" },
        ],
      },
      { to: "/admin/payslips", label: "Payslips" },
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

function NavGroupItem({ item, currentPath }) {
  const isParent = !!item.children;
  const isActiveGroup = isParent && item.children.some((c) => c.to === currentPath);
  const [open, setOpen] = useState(isActiveGroup);

  if (!isParent) {
    return (
      <NavLink to={item.to} className={({ isActive }) => (isActive ? "active" : "")}>
        {item.label}
      </NavLink>
    );
  }

  return (
    <div className="nav-collapsible">
      <button type="button" className={`nav-collapsible-toggle ${isActiveGroup ? "active-parent" : ""}`} onClick={() => setOpen((o) => !o)}>
        <span>{item.label}</span>
        <span className={`nav-chevron ${open ? "open" : ""}`}>▸</span>
      </button>
      {open && (
        <div className="nav-collapsible-body">
          {item.children.map((c) => (
            <NavLink key={c.to} to={c.to} className={({ isActive }) => (isActive ? "active" : "")}>
              {c.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const { flags } = useFeatureFlags();
  const { pathname } = useLocation();
  const isTeamLead = user?.role === "team_lead";

  const visibleGroups = NAV_GROUPS
    .filter((group) => group.label !== "PM" || (flags.projectManagement && !isTeamLead))
    .map((group) => ({
      ...group,
      items: group.items
        .map((item) => (item.children ? { ...item, children: item.children.filter((c) => !isTeamLead || TEAM_LEAD_PATHS.includes(c.to)) } : item))
        .filter((item) => (item.children ? item.children.length > 0 : !isTeamLead || TEAM_LEAD_PATHS.includes(item.to))),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.jpeg" alt="EHSC" className="brand-logo" />
          <h1>EHSC</h1>
        </div>
        <nav>
          <div className="sidebar-scroll">
            {visibleGroups.map((group) => (
              <div className="nav-group" key={group.label}>
                <span className="nav-group-label">{group.label}</span>
                {group.items.map((item) => (
                  <NavGroupItem key={item.label || item.to} item={item} currentPath={pathname} />
                ))}
              </div>
            ))}
          </div>
          <div className="sidebar-footer">
            <span className="sidebar-user">{user?.name} ({user?.role})</span>
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
