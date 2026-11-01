import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { LoaderCircle } from "lucide-react";

export default function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading, configured } = useAuth();
  if (loading) return <div className="loading-screen"><LoaderCircle className="spin" /> Loading NexMeet…</div>;
  if (!configured) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}