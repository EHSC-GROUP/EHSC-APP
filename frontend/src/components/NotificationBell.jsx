import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import client from "../api/client";

function formatWhen(at) {
  if (!at) return "";
  if (at._seconds) return new Date(at._seconds * 1000).toLocaleString();
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

// Polls unread-count rather than anything push-based — there's no
// websocket/SSE layer in this app, and a 60s poll is plenty responsive for
// "an admin should raise an invoice soon", not a real-time chat need.
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [count, setCount] = useState(0);
  const navigate = useNavigate();
  const boxRef = useRef(null);

  async function loadCount() {
    try {
      const { data } = await client.get("/notifications/unread-count");
      setCount(data.count);
    } catch {
      // Not fatal — the bell just shows no badge until the next poll.
    }
  }

  useEffect(() => {
    loadCount();
    const interval = setInterval(loadCount, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function onClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) {
      try {
        const { data } = await client.get("/notifications");
        setItems(data);
      } catch {
        setItems([]);
      }
    }
  }

  async function handleClick(n) {
    if (!n.read) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setCount((c) => Math.max(0, c - 1));
      client.put(`/notifications/${n.id}/read`).catch(() => {});
    }
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  }

  async function markAllRead() {
    setItems((list) => list.map((x) => ({ ...x, read: true })));
    setCount(0);
    try {
      await client.put("/notifications/read-all");
    } catch {
      loadCount();
    }
  }

  return (
    <div className="notification-bell" ref={boxRef}>
      <button type="button" className="notification-bell-toggle" onClick={toggleOpen} title="Notifications">
        🔔
        {count > 0 && <span className="badge-pill badge-PENDING notification-badge">{count > 99 ? "99+" : count}</span>}
      </button>
      {open && (
        <div className="notification-panel">
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <strong>Notifications</strong>
            <div className="spacer" />
            {items.some((n) => !n.read) && <button type="button" className="btn-sm" onClick={markAllRead}>Mark all read</button>}
          </div>
          {items.length === 0 && <div className="empty-state">No notifications yet.</div>}
          {items.map((n) => (
            <div key={n.id} className={`notification-item ${n.read ? "" : "unread"}`} onClick={() => handleClick(n)}>
              <div>{n.message}</div>
              <div className="hint-text">{formatWhen(n.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
