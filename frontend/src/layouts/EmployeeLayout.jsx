import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import PersonalDetailsPrompt from "../components/PersonalDetailsPrompt";

export default function EmployeeLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  // Admins/superadmin reach these pages from their dashboard, so "home" for
  // them is the dashboard, not the employee hub.
  const isStaff = ["admin", "superadmin", "team_lead"].includes(user?.role);
  const home = isStaff ? "/admin" : "/me";

  // Associates can only open Reimbursements; anything else goes back to the hub.
  if (user?.isAssociate && location.pathname !== "/me" && !location.pathname.startsWith("/me/reimbursements")) {
    return <Navigate to="/me" replace />;
  }

  return (
    <div>
      <header style={{ display: "flex", alignItems: "center", padding: "14px 24px", background: "#111827", color: "#fff" }}>
        <Link to={home} style={{ color: "#fff", fontWeight: 600, display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/logo.jpeg" alt="EHSC" style={{ height: 30, width: 30, objectFit: "contain", background: "#fff", borderRadius: 6, padding: 2 }} />
          EHSC — Self Service
        </Link>
        <div style={{ flex: 1 }} />
        {location.pathname !== "/me" && (
          <Link to={home} style={{ color: "#d1d5db", marginRight: 16 }}>&larr; Back to {isStaff ? "Home" : "Hub"}</Link>
        )}
        <span style={{ color: "#d1d5db", marginRight: 16 }}>{user?.name}</span>
        <button className="btn-logout" onClick={logout}>Log out</button>
      </header>
      <main className="main-content">
        <PersonalDetailsPrompt />
        <Outlet />
      </main>
    </div>
  );
}
