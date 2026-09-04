import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import client from "../../api/client";
import { useAuth } from "../../context/AuthContext";

export default function Hub() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [badges, setBadges] = useState({ pendingLeave: 0, pendingReimbursements: 0 });
  const [hasReimbAccess, setHasReimbAccess] = useState(null);

  useEffect(() => {
    client.get("/me/badges").then((r) => setBadges(r.data)).catch(() => {});
    client.get("/me/profile").then((r) => setHasReimbAccess(!!r.data.reimbursementAccess)).catch(() => setHasReimbAccess(false));
  }, []);

  const cards = [
    { to: "/change-password", title: "Change Password", desc: "Update your login password" },
    { to: "/me/leave", title: "Leave", desc: "Apply, view balances and requests", badge: badges.pendingLeave },
    { to: "/me/reimbursements", title: "Reimbursements", desc: hasReimbAccess === false ? "Access not granted" : "Submit and track vouchers", badge: badges.pendingReimbursements, disabled: hasReimbAccess === false },
    { to: "/me/attendance", title: "Attendance", desc: "Your login/logout history" },
    { to: "/me/profile", title: "HR Details", desc: "Your profile (read-only)" },
    { to: "/me/documents", title: "Documents", desc: "Your files and company documents" },
    { to: "/me/payslips", title: "My Payslips", desc: "Published payslips" },
    { to: "/me/activity", title: "Activity", desc: "Recent status updates" },
  ];

  return (
    <div>
      <div className="page-header"><h2>Welcome, {user?.name}</h2></div>
      <div className="hub-grid">
        {cards.map((c) => (
          <div key={c.to} className="hub-card" onClick={() => navigate(c.to)}>
            <div className="title">{c.title}{!!c.badge && <span className="badge-pill badge-PENDING" style={{ marginLeft: 8 }}>{c.badge}</span>}</div>
            <div className="desc">{c.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
