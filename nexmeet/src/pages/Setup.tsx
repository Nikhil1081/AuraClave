import { Link } from "react-router-dom";
import Brand from "../components/Brand";
import { CheckCircle2, ArrowRight } from "lucide-react";

export default function Setup() {
  return (
    <main className="center-page">
      <div className="setup-card">
        <Brand />
        <div className="eyebrow">DATABASE & AUTH READY</div>
        <h1>Workspace is connected.</h1>
        <p className="muted">
          AuraClave is configured with internal database connectivity and secure JWT authentication.
        </p>
        <div className="setup-step">
          <CheckCircle2 color="#22c55e" />
          <div>
            <b>Self-Hosted Database</b>
            <span>User authentication and session tokens are managed directly by your AuraClave backend without third-party sleep limits.</span>
          </div>
        </div>
        <Link className="button primary full" to="/dashboard">
          Go to Dashboard <ArrowRight size={17} />
        </Link>
        <Link className="back-link" to="/">
          Back to home
        </Link>
      </div>
    </main>
  );
}
