import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { auth, type AuthSession, type AuthUser } from "../lib/auth";

type AuthValue = {
  user: AuthUser | null;
  session: AuthSession | null;
  loading: boolean;
  configured: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => auth.getUser());
  const [session, setSession] = useState<AuthSession | null>(() => auth.getSession());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    function syncAuth() {
      const currentSession = auth.getSession();
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
    }

    // Verify session with backend asynchronously
    auth.verifySession().then((verifiedUser) => {
      if (verifiedUser) {
        setUser(verifiedUser);
        const currentSession = auth.getSession();
        setSession(currentSession);
      } else {
        syncAuth();
      }
      setLoading(false);
    }).catch(() => {
      syncAuth();
      setLoading(false);
    });

    window.addEventListener("auraclave:auth_change", syncAuth);
    window.addEventListener("storage", syncAuth);

    return () => {
      window.removeEventListener("auraclave:auth_change", syncAuth);
      window.removeEventListener("storage", syncAuth);
    };
  }, []);

  const value: AuthValue = {
    user,
    session,
    loading,
    configured: true,
    signOut: async () => {
      auth.signOut();
      setUser(null);
      setSession(null);
    }
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
