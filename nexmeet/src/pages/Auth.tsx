import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Mail, UserRound } from "lucide-react";
import Brand from "../components/Brand";
import { supabase } from "../lib/supabase";

export default function Auth() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMessage("");
    if (!supabase) { setMessage("Supabase is not configured. Add your environment variables."); return; }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
        if (error) throw error;
        if (data.session) navigate("/dashboard");
        else setMessage("Account created. Check your email to confirm your address, then sign in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate("/dashboard");
      }
    } catch (err) { setMessage(err instanceof Error ? err.message : "Authentication failed."); }
    finally { setBusy(false); }
  }

  return <main className="auth-layout"><div className="auth-visual"><div className="visual-orb orb-one"/><div className="visual-orb orb-two"/><Brand /><div className="visual-copy"><div className="eyebrow">MEET WITHOUT LIMITS</div><h1>Good ideas<br/><span>sound better</span><br/>together.</h1><p>Clear conversations. Focused collaboration. One space for your team.</p><div className="visual-foot"><span className="status-dot"/> Your next great conversation starts here.</div></div></div><div className="auth-panel"><Link to="/" className="back-link"><ArrowLeft size={16}/> Back to home</Link><div className="auth-form-wrap"><div className="eyebrow">WELCOME TO AURACLAVE</div><h2>{mode === "login" ? "Welcome back" : "Create your account"}</h2><p className="muted">{mode === "login" ? "Sign in to pick up where you left off." : "A better way to bring people together."}</p><form onSubmit={submit} className="form-stack">{mode === "signup" && <label>Full name<div className="input-wrap"><UserRound size={17}/><input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" required /></div></label>}<label>Email address<div className="input-wrap"><Mail size={17}/><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com" required /></div></label><label>Password<div className="input-wrap"><LockKeyhole size={17}/><input type={show ? "text" : "password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 6 characters" minLength={6} required/><button type="button" className="icon-button" onClick={()=>setShow(!show)} aria-label="Toggle password visibility">{show ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></label>{message && <div className="notice">{message}</div>}<button className="button primary full" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"} <ArrowRight size={17}/></button></form><p className="switch-auth">{mode === "login" ? "New to AuraClave?" : "Already have an account?"} <button onClick={()=>{setMode(mode === "login" ? "signup" : "login");setMessage("");}}>{mode === "login" ? "Create an account" : "Sign in"}</button></p></div><div className="auth-legal">By continuing, you agree to use AuraClave responsibly.</div></div></main>;
}