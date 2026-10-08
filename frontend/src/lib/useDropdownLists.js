import { useEffect, useState } from "react";
import client from "../api/client";

// The editable dropdown lists (status, priority, risk, payment status, region)
// from Settings, fetched once and shared. Call refreshDropdownLists() after
// saving them so open screens pick up the change.
let cached = null;
let inflight = null;
const listeners = new Set();

function load() {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = client.get("/settings/dropdown-lists").then((r) => {
      cached = r.data;
      return cached;
    }).finally(() => { inflight = null; });
  }
  return inflight;
}

export function refreshDropdownLists(next) {
  cached = next || null;
  listeners.forEach((fn) => fn(cached));
}

export function useDropdownLists() {
  const [data, setData] = useState(cached);
  useEffect(() => {
    listeners.add(setData);
    if (!cached) load().then(setData).catch(() => {});
    return () => { listeners.delete(setData); };
  }, []);
  // Sensible fallbacks so a form renders before the lists arrive.
  return data?.lists || { projectStatus: [], priority: [], risk: [], paymentStatus: [], region: [] };
}

export function useDropdownListLabels() {
  const [data, setData] = useState(cached);
  useEffect(() => {
    listeners.add(setData);
    if (!cached) load().then(setData).catch(() => {});
    return () => { listeners.delete(setData); };
  }, []);
  return data?.labels || {};
}
