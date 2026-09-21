import { createContext, useContext, useEffect, useState, useCallback } from "react";
import client from "../api/client";
import { useAuth } from "./AuthContext";

const FeatureFlagsContext = createContext({ flags: {}, loading: true, refresh: () => {} });

// Loaded once per login (not per page) so every nav/route guard that reads
// a flag agrees with every other one in the same session.
export function FeatureFlagsProvider({ children }) {
  const { user } = useAuth();
  const [flags, setFlags] = useState({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) { setFlags({}); setLoading(false); return; }
    try {
      const { data } = await client.get("/settings/feature-flags");
      setFlags(data);
    } catch {
      setFlags({});
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <FeatureFlagsContext.Provider value={{ flags, loading, refresh }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlags() {
  return useContext(FeatureFlagsContext);
}
