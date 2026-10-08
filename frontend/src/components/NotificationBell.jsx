import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import client from "../api/client";
import { fmtDateTime } from "../lib/dates";

function formatWhen(at) {
  if (!at) return "";
  if (at._seconds) return fmtDateTime(new Date(at._seconds * 1000));
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : fmtDateTime(d);
}

// Polls the full list rather than anything push-based — there's no
// websocket/SSE layer in this app. 20s keeps a pop-up feeling timely
// without hammering the API.
const POLL_MS = 20000;
const TOAST_MS = 10000;

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [count, setCount] = useState(0);
  const [toasts, setToasts] = useState([]);
  const navigate = useNavigate();
  const boxRef = useRef(null);
  const seenIds = useRef(new Set());
  const initialized = useRef(false);

  function dismissToast(id) {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }

  async function poll() {
    try {
      const { data } = await client.get("/notifications");
      setItems(data);
      const unread = data.filter((n) => !n.read);
      setCount(unread.length);

      if (!initialized.current) {
        // First load after the page opens — these are pre-existing unread
        // notifications, not new arrivals, so remember them without
        // popping a toast for each one.
        unread.forEach((n) => seenIds.current.add(n.id));
        initialized.current = true;
        return;
      }
      const fresh = unread.filter((n) => !seenIds.current.has(n.id));
      fresh.forEach((n) => {
        seenIds.current.add(n.id);
        setToasts((cur) => [...cur, n]);
        setTimeout(() => dismissToast(n.id), TOAST_MS);
      });
    } catch {
      // Not fatal — the bell just shows stale data until the next poll.
    }
  }

  useEffect(() => {
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function onClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function markRead(n) {
    setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    setCount((c) => Math.max(0, c - 1));
    client.put(`/notifications/${n.id}/read`).catch(() => {});
  }

  function handleClick(n) {
    if (!n.read) markRead(n);
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  }

  function handleToastClick(n) {
    dismissToast(n.id);
    handleClick(n);
  }

  async function markAllRead() {
    setItems((list) => list.map((x) => ({ ...x, read: true })));
    setCount(0);
    try {
      await client.put("/notifications/read-all");
    } catch {
      poll();
    }
  }

  return (
    <>
      <div className="notification-toast-stack">
        {toasts.map((n) => (
          <div key={n.id} className="notification-toast" onClick={() => handleToastClick(n)}>
            <button
              type="button"
              className="notification-toast-close"
              onClick={(e) => { e.stopPropagation(); dismissToast(n.id); }}
              title="Dismiss"
            >
              ×
            </button>
            <strong>🔔 Notification</strong>
            <div>{n.message}</div>
          </div>
        ))}
      </div>

      <div className="notification-bell" ref={boxRef}>
        <button type="button" className="notification-bell-toggle" onClick={() => setOpen((o) => !o)} title="Notifications">
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
    </>
  );
}
