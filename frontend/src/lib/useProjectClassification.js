import { useEffect, useState } from "react";
import client from "../api/client";

// The Project Category -> Service -> Project Type tree comes from the server
// (single source of truth); fetched once and shared.
let cached = null;
let inflight = null;

function load() {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = client.get("/settings/project-classification").then((r) => {
      cached = r.data;
      return cached;
    }).finally(() => { inflight = null; });
  }
  return inflight;
}

export function useProjectClassification() {
  const [catalog, setCatalog] = useState(cached);
  useEffect(() => {
    if (!catalog) load().then(setCatalog).catch(() => {});
  }, [catalog]);

  const labelOf = (list, value) => list?.find((x) => x.value === value)?.label;
  return {
    catalog,
    categoryLabel: (v) => (v ? labelOf(catalog?.categories, v) || v : ""),
    // Older records may hold a type from before the new list; show those as stored.
    typeLabel: (v) => (v ? labelOf(catalog?.allTypes, v) || v : ""),
    serviceLabel: (cat, v) => {
      if (!v) return "";
      const c = catalog?.categories.find((x) => x.value === cat);
      return labelOf(c?.services, v) || v;
    },
  };
}
