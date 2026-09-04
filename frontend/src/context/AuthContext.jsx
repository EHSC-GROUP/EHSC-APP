import { createContext, useContext, useState, useCallback } from "react";
import client from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("hr_user");
    return raw ? JSON.parse(raw) : null;
  });

  const login = useCallback(async (userId, password) => {
    const { data } = await client.post("/auth/login", { userId, password });
    localStorage.setItem("hr_token", data.token);
    localStorage.setItem("hr_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("hr_token");
    localStorage.removeItem("hr_user");
    setUser(null);
  }, []);

  const refreshMe = useCallback(async () => {
    const { data } = await client.get("/auth/me");
    localStorage.setItem("hr_user", JSON.stringify(data));
    setUser(data);
    return data;
  }, []);

  const isAdmin = user && ["admin", "superadmin"].includes(user.role);

  return (
    <AuthContext.Provider value={{ user, login, logout, refreshMe, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
