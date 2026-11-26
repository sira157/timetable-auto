import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getToken, onUnauthorized, setToken } from "../lib/api";
import type { User } from "../lib/types";

interface AuthValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    onUnauthorized(logout);
    if (!getToken()) {
      setLoading(false);
      return () => onUnauthorized(null);
    }
    api
      .get<User>("/api/auth/me")
      .then(setUser)
      .catch(logout)
      .finally(() => setLoading(false));
    return () => onUnauthorized(null);
  }, [logout]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post<{ token: string; user: User }>("/api/auth/login", { username, password });
    setToken(res.token);
    setUser(res.user);
  }, []);

  const changePassword = useCallback(async (oldPassword: string, newPassword: string) => {
    const res = await api.post<{ token: string; user: User }>("/api/auth/password", {
      old_password: oldPassword,
      new_password: newPassword,
    });
    setToken(res.token);
    setUser(res.user);
  }, []);

  const value = useMemo(() => ({ user, loading, login, changePassword, logout }), [user, loading, login, changePassword, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth ต้องใช้ภายใน AuthProvider");
  return ctx;
}

export const MIN_PASSWORD_LENGTH = 6;
