import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import StatusBadge from "../../components/StatusBadge";
import { Loading, ErrorText } from "../../components/Misc";

function actionEndpoint(a) {
  return a.source === "project"
    ? `/projects/${a.sourceId}/plan-actions/${a.id}`
    : `/business-development/${a.sourceId}/actions/${a.id}`;
}

export default function MyProjectTracker() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    client.get("/me/assigned-work").then((r) => setItems(r.data)).catch((err) => setError(errorMessage(err)));
  }, []);

  async function toggleCompleted(a) {
    setError("");
    setBusyId(a.id);
    try {
      const completed = !a.completed;
      await client.put(actionEndpoint(a), { completed });
      setItems((list) => list.map((x) => (x.id === a.id ? { ...x, completed, completedAt: completed ? new Date().toISOString() : null } : x)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="page-header"><h2>Project Tracker</h2></div>
      <ErrorText>{error}</ErrorText>
      <div className="card">
        {!items ? (
          <Loading />
        ) : (
          <AssignedWorkTable items={items} busyId={busyId} onToggle={toggleCompleted} />
        )}
      </div>
    </div>
  );
}

function AssignedWorkTable({ items, busyId, onToggle }) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Description</th><th>From</th><th>Due</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {items.map((a) => {
            const overdue = !a.completed && a.dueDate && a.dueDate < today;
            return (
              <tr key={`${a.source}-${a.sourceId}-${a.id}`}>
                <td>
                  {a.description}
                  <div className="hint-text">
                    {a.source === "project" ? "Project" : "Enquiry"} {a.sourceLabel} — {a.clientName}
                  </div>
                </td>
                <td>{a.startDate || "-"}</td>
                <td className={overdue ? "overdue" : ""}>{a.dueDate}{overdue ? " (overdue)" : ""}</td>
                <td><StatusBadge status={a.completed ? "COMPLETED" : "PENDING"} /></td>
                <td>
                  <button className="btn-sm" disabled={busyId === a.id} onClick={() => onToggle(a)}>
                    {busyId === a.id ? "Saving…" : a.completed ? "Mark Pending" : "Mark Complete"}
                  </button>
                </td>
              </tr>
            );
          })}
          {items.length === 0 && <tr><td colSpan={5} className="empty-state">No work assigned to you yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
