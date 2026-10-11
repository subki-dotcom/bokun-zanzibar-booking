import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchMe, login as loginRequest } from "../api/transferAdminApi";
import { UNAUTHORIZED_EVENT, tokenStore } from "../api/client";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));
  const [sessionMessage, setSessionMessage] = useState("");

  const logout = useCallback((message = "") => {
    tokenStore.clear();
    setUser(null);
    setSessionMessage(message);
  }, []);

  useEffect(() => {
    if (!tokenStore.get()) return undefined;
    let active = true;
    fetchMe()
      .then((profile) => active && setUser(profile))
      .catch(() => active && logout())
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [logout]);

  useEffect(() => {
    const onUnauthorized = () => logout("Your session has ended. Please sign in again.");
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [logout]);

  const login = useCallback(async (credentials) => {
    const result = await loginRequest(credentials);
    tokenStore.set(result.token);
    setUser(result.user);
    setSessionMessage("");
    return result.user;
  }, []);

  // Used after a password change, which returns a fresh token and revokes older sessions.
  const replaceSession = useCallback((result) => {
    tokenStore.set(result.token);
    setUser(result.user);
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, replaceSession, sessionMessage }), [user, loading, login, logout, replaceSession, sessionMessage]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
};
