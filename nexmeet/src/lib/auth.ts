export interface AuthUser {
  id: string;
  email: string;
  user_metadata?: {
    full_name?: string;
  };
}

export interface AuthSession {
  access_token: string;
  user: AuthUser;
}

const TOKEN_KEY = "auraclave_auth_token";
const USER_KEY = "auraclave_auth_user";

export function getApiBase(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && typeof envUrl === "string") {
    return envUrl.replace(/\/$/, "");
  }
  return "";
}

export const auth = {
  getToken(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },

  getUser(): AuthUser | null {
    try {
      const stored = localStorage.getItem(USER_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  },

  getSession(): AuthSession | null {
    const token = this.getToken();
    const user = this.getUser();
    if (!token || !user) return null;
    return { access_token: token, user };
  },

  async signUp(email: string, password: string, name: string): Promise<{ user: AuthUser; token: string }> {
    const base = getApiBase();
    const url = base ? `${base}/api/auth/signup` : "/api/auth/signup";

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to sign up.");
    }

    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    window.dispatchEvent(new Event("auraclave:auth_change"));

    return data;
  },

  async signIn(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
    const base = getApiBase();
    const url = base ? `${base}/api/auth/login` : "/api/auth/login";

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Invalid email or password.");
    }

    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    window.dispatchEvent(new Event("auraclave:auth_change"));

    return data;
  },

  async verifySession(): Promise<AuthUser | null> {
    const token = this.getToken();
    if (!token) return null;

    const base = getApiBase();
    const url = base ? `${base}/api/auth/me` : "/api/auth/me";

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        this.signOut();
        return null;
      }
      const data = await res.json();
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      return data.user;
    } catch {
      // If server is unreachable but we have cached user, maintain offline session
      return this.getUser();
    }
  },

  signOut(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.dispatchEvent(new Event("auraclave:auth_change"));
  }
};
