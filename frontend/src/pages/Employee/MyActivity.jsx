import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { Loading, ErrorText } from "../../components/Misc";

function formatWhen(at) {
  if (!at) return "";
  if (at._seconds) return new Date(at._seconds * 1000).toLocaleString();
  return "";
}

export default function MyActivity() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    client.get("/me/activity").then((r) => setEvents(r.data)).catch((err) => setError(errorMessage(err)));
  }, []);

  return (
    <div>
      <div className="page-header"><h2>Activity</h2></div>
      <ErrorText>{error}</ErrorText>
      {!events ? <Loading /> : (
        <div className="card">
          {events.map((e) => (
            <div key={`${e.type}-${e.id}`} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <div>{e.summary}</div>
              <div className="hint-text">{formatWhen(e.at)}</div>
            </div>
          ))}
          {events.length === 0 && <div className="empty-state">No recent activity.</div>}
        </div>
      )}
    </div>
  );
}
