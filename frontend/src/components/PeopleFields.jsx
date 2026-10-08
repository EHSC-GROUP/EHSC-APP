import { usePeople } from "../lib/usePeople";

const TYPE_TAG = { team_leader: "Team Leader", admin: "Admin", associate: "Associate" };
const label = (p) => `${p.name} (${p.userId})${TYPE_TAG[p.type] ? ` · ${TYPE_TAG[p.type]}` : ""}`;

// Team Lead: pick one person (staff only; associates aren't team leads).
export function TeamLeadSelect({ value, onChange }) {
  const people = usePeople().filter((p) => p.type !== "associate");
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value, people.find((p) => p.userId === e.target.value)?.name || "")}>
      <option value="">Select…</option>
      {people.map((p) => <option key={p.userId} value={p.userId}>{label(p)}</option>)}
    </select>
  );
}

// Team Members: pick any number of people (associates included). Shown as
// removable chips with an "add" dropdown, so it's easy to see who is on the team.
export function TeamMembersPicker({ value = [], onChange }) {
  const people = usePeople();
  const chosen = new Set(value.map((m) => m.userId));
  const available = people.filter((p) => !chosen.has(p.userId));
  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        {value.length === 0 && <span className="hint-text">No team members yet.</span>}
        {value.map((m) => (
          <span key={m.userId} className="badge-pill badge-PENDING" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {m.name || m.userId}
            <button type="button" onClick={() => onChange(value.filter((x) => x.userId !== m.userId))} aria-label={`Remove ${m.name}`} style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>
          </span>
        ))}
      </div>
      <select
        value=""
        onChange={(e) => {
          const p = people.find((x) => x.userId === e.target.value);
          if (p) onChange([...value, { userId: p.userId, name: p.name }]);
        }}
      >
        <option value="">+ Add a team member…</option>
        {available.map((p) => <option key={p.userId} value={p.userId}>{label(p)}</option>)}
      </select>
    </div>
  );
}
