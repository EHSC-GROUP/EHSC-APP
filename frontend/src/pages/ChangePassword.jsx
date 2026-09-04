import { useState } from "react";
import { useNavigate } from "react-router-dom";
import client, { errorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function ChangePassword() {
  const { user, refreshMe } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirm) return setError("New passwords do not match");
    if (newPassword.length < 8) return setError("New password must be at least 8 characters");
    setBusy(true);
    try {
      await client.post("/auth/change-password", { currentPassword, newPassword });
      const me = await refreshMe();
      navigate(["admin", "superadmin"].includes(me.role) ? "/admin" : "/me");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Change Password</h1>
        {user?.mustReset && <p className="hint-text">Your password was reset by an administrator. Please set a new one.</p>}
        <label>Current Password</label>
        <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required autoFocus />
        <label>New Password</label>
        <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
        <label>Confirm New Password</label>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {error && <div className="error-text">{error}</div>}
        <button className="btn-primary" style={{ width: "100%", marginTop: 18 }} disabled={busy}>
          {busy ? "Saving…" : "Update Password"}
        </button>
      </form>
    </div>
  );
}
