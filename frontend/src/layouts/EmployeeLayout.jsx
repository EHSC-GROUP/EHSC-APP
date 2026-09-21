import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function EmployeeLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div>
      <header style={{ display: "flex", alignItems: "center", padding: "14px 24px", background: "#111827", color: "#fff" }}>
        <Link to="/me" style={{ color: "#fff", fontWeight: 600, display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/logo.jpeg" alt="EHSC" style={{ height: 30, width: 30, objectFit: "contain", background: "#fff", borderRadius: 6, padding: 2 }} />
          EHSC — Self Service
        </Link>
        <div style={{ flex: 1 }} />
        {location.pathname !== "/me" && (
          <Link to="/me" style={{ color: "#d1d5db", marginRight: 16 }}>&larr; Back to Hub</Link>
        )}
        <span style={{ color: "#d1d5db", marginRight: 16 }}>{user?.name}</span>
        <button className="btn-logout" onClick={logout}>Log out</button>
      </header>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
