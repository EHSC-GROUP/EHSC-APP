import { useEffect, useState } from "react";
import client from "../api/client";

// Active people from the profile list (employees, admins, team leaders and
// associates), for the Team Lead / Team Members pickers. Cached per page load.
let cached = null;
let inflight = null;

export function usePeople() {
  const [people, setPeople] = useState(cached || []);
  useEffect(() => {
    if (cached) return;
    if (!inflight) {
      inflight = client.get("/profiles").then((r) => {
        cached = r.data.filter((p) => !p.disabled).map((p) => ({ userId: p.userId, name: p.name || p.userId, type: p.type }));
        return cached;
      }).finally(() => { inflight = null; });
    }
    inflight.then(setPeople).catch(() => {});
  }, []);
  return people;
}
