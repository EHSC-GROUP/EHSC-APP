import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import client from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useFeatureFlags } from "../../context/FeatureFlagsContext";

// Landing page for admins and the superadmin — same card grid as the
// employee Hub, but each card only appears if that role may open the page
// (mirrors the sidebar and the route guards in App.jsx).
export default function AdminHome() {
  const { user } = useAuth();
  const { flags } = useFeatureFlags();
  const navigate = useNavigate();
  const isSuperAdmin = user?.role === "superadmin";
  const [hasReimbAccess, setHasReimbAccess] = useState(null);

  useEffect(() => {
    client.get("/me/profile").then((r) => setHasReimbAccess(!!r.data.reimbursementAccess)).catch(() => setHasReimbAccess(false));
  }, []);

  const groups = [
    {
      label: "Project Management",
      show: !!flags.projectManagement,
      cards: [
        { to: "/admin/business-development", title: "Business Development", desc: "Enquiries, proposals and follow-ups" },
        { to: "/admin/company-profiles", title: "Company Profiles", desc: "Clients, branches and their projects" },
        { to: "/admin/project-tracker", title: "Project Tracker", desc: "Plans, actions and invoice stages" },
      ],
    },
    {
      label: "HR & Payroll",
      show: true,
      cards: [
        { to: "/admin/profiles", title: "Employee Profiles", desc: "Staff records and salary structures", superOnly: true },
        { to: "/admin/associates", title: "Associate Profiles", desc: "External associates", superOnly: true },
        { to: "/admin/attendance", title: "Attendance", desc: "Daily status and check-ins" },
        { to: "/admin/leave", title: "Leave Management", desc: "Register, balances and approvals" },
        { to: "/admin/holidays", title: "Holidays", desc: "Company holiday calendar" },
        { to: "/admin/payslips", title: "Payslips", desc: "Generate, finalize and publish", superOnly: true },
      ],
    },
    {
      label: "Finance & Operations",
      show: true,
      cards: [
        { to: "/admin/company-wallet", title: "Company Wallet", desc: "Balance and advances", superOnly: true },
        { to: "/admin/reimbursements", title: "Reimbursements", desc: "Review and approve vouchers" },
        { to: "/admin/material-indents", title: "Material Indents", desc: "Material requests for jobs" },
        { to: "/admin/travel", title: "Travel", desc: "Travel approval requests" },
        { to: "/admin/documents", title: "Compliance", desc: "Company documents", superOnly: true },
        { to: "/admin/settings", title: "Settings", desc: "Feature flags, rules and templates", superOnly: true },
      ],
    },
    {
      label: "Self Service (for you)",
      show: true,
      cards: [
        { to: "/change-password", title: "Change Password", desc: "Update your login password" },
        { to: "/me/leave", title: "Leave", desc: "Apply, view balances and requests" },
        { to: "/me/reimbursements", title: "Reimbursements", desc: hasReimbAccess === false ? "Access not granted" : "Submit and track vouchers" },
        { to: "/me/material-indents", title: "Material Indents", desc: "Request materials for a job" },
        { to: "/me/attendance", title: "Attendance", desc: "Your daily status and check-in history" },
        { to: "/me/travel", title: "Travel", desc: "Ask for approval to travel on a date" },
        { to: "/me/profile", title: "HR Details", desc: "Your profile (read-only)" },
        ...(flags.projectManagement ? [{ to: "/me/project-tracker", title: "Project Tracker", desc: "Work assigned to you" }] : []),
        { to: "/me/documents", title: "Documents", desc: "Your files and company documents" },
        { to: "/me/payslips", title: "My Payslips", desc: "Published payslips" },
        { to: "/me/activity", title: "Activity", desc: "Recent status updates" },
      ],
    },
  ];

  return (
    <div>
      <div className="page-header"><h2>Welcome, {user?.name}</h2></div>
      {groups.filter((g) => g.show).map((g) => {
        const cards = g.cards.filter((c) => !c.superOnly || isSuperAdmin);
        if (cards.length === 0) return null;
        return (
          <div key={g.label} style={{ marginBottom: 20 }}>
            <p className="hint-text" style={{ margin: "0 0 8px", textTransform: "uppercase", fontWeight: 600, letterSpacing: 0.5 }}>{g.label}</p>
            <div className="hub-grid">
              {cards.map((c) => (
                <div key={c.to} className="hub-card" onClick={() => navigate(c.to)}>
                  <div className="title">{c.title}</div>
                  <div className="desc">{c.desc}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
