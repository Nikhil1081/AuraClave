import { Link } from "react-router-dom";
import Brand from "../components/Brand";
import { KeyRound, ArrowRight } from "lucide-react";

export default function Setup() {
  return <main className="center-page"><div className="setup-card"><Brand /><div className="eyebrow">ONE-TIME CONFIGURATION</div><h1>Connect your workspace.</h1><p className="muted">NexMeet needs your Supabase project URL and publishable key before sign-in can work.</p><div className="setup-step"><KeyRound /><div><b>1. Create a Supabase project</b><span>Open Supabase, create a project, then copy the Project URL and Publishable key from Project Settings → API Keys.</span></div></div><div className="setup-step"><ArrowRight /><div><b>2. Add frontend environment variables</b><code>VITE_SUPABASE_URL=...</code><code>VITE_SUPABASE_ANON_KEY=...</code></div></div><p className="muted small">Save these in <code>.env.local</code> at the project root and restart the dev server.</p><a className="button primary full" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Open Supabase <ArrowRight size={17}/></a><Link className="back-link" to="/">Back to home</Link></div></main>;
}