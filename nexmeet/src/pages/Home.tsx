import { Link } from "react-router-dom";
import { ArrowRight, AudioLines, Check, MessageSquare, MonitorUp, ShieldCheck, Sparkles, Video, Zap } from "lucide-react";
import Brand from "../components/Brand";
import LanguageSelector from "../components/LanguageSelector";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../contexts/LanguageContext";

export default function Home() {
  const { user } = useAuth();
  const { t } = useLanguage();

  return (
    <div className="marketing">
      <nav className="nav container">
        <Brand />
        <div className="nav-links">
          <a href="#features">{t("nav_features")}</a>
          <a href="#about">{t("nav_why")}</a>
        </div>
        <div className="nav-actions">
          <LanguageSelector />
          {user ? (
            <Link className="button primary small-button" to="/dashboard">
              {t("nav_dashboard")} <ArrowRight size={16} />
            </Link>
          ) : (
            <>
              <Link className="nav-login" to="/auth">
                {t("nav_signin")}
              </Link>
              <Link className="button primary small-button" to="/auth">
                {t("nav_getstarted")} <ArrowRight size={16} />
              </Link>
            </>
          )}
        </div>
      </nav>

      <section className="hero container">
        <div className="hero-copy">
          <div className="pill">
            <span className="status-dot" /> {t("hero_pill")}
          </div>
          <h1>
            {t("hero_title_1")}
            <br />
            <span>{t("hero_title_2")}</span>
          </h1>
          <p className="hero-description">{t("hero_desc")}</p>
          <div className="hero-actions">
            <Link className="button primary" to={user ? "/dashboard" : "/auth"}>
              {t("hero_start")} <ArrowRight size={18} />
            </Link>
            <a className="button secondary" href="#features">
              {t("hero_explore")}
            </a>
          </div>
          <div className="hero-trust">
            <div className="avatar-stack">
              <i>N</i>
              <i>A</i>
              <i>J</i>
              <i>+</i>
            </div>
            <span>{t("hero_built")}</span>
          </div>
        </div>

        <div className="hero-art">
          <div className="art-glow" />
          <div className="call-window">
            <div className="call-top">
              <span className="window-dots">
                <i />
                <i />
                <i />
              </span>
              <span>Weekly sync</span>
              <span className="live-label">
                <b /> LIVE
              </span>
            </div>
            <div className="call-grid">
              <div className="person person-one">
                <span className="person-avatar">AM</span>
                <span className="person-name">Alex Morgan</span>
              </div>
              <div className="person person-two">
                <span className="person-avatar">SK</span>
                <span className="person-name">Sam Kim</span>
              </div>
              <div className="person person-three">
                <span className="person-avatar">JR</span>
                <span className="person-name">Jamie Reed</span>
              </div>
              <div className="person person-four">
                <div className="share-preview">
                  <div className="share-line long" />
                  <div className="share-line" />
                  <div className="share-chart">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
                <span className="person-name">You are presenting</span>
              </div>
            </div>
            <div className="call-toolbar">
              <span>
                <AudioLines size={16} />
              </span>
              <span>
                <Video size={16} />
              </span>
              <span className="toolbar-active">
                <MonitorUp size={16} />
              </span>
              <span>
                <MessageSquare size={16} />
              </span>
              <span className="call-end">×</span>
            </div>
          </div>
          <div className="floating-note">
            <span className="note-icon">
              <Sparkles size={16} />
            </span>
            <div>
              <b>Stay in sync</b>
              <small>Ideas flow naturally.</small>
            </div>
          </div>
          <div className="floating-secure">
            <ShieldCheck size={16} /> Private by design
          </div>
        </div>
      </section>

      <section className="feature-strip container" id="features">
        <div className="section-heading">
          <div className="eyebrow">MADE FOR MOMENTUM</div>
          <h2>
            Everything clicks
            <br />
            when you connect.
          </h2>
          <p>Simple tools that keep your team in the conversation.</p>
        </div>
        <div className="feature-grid">
          <article className="feature-card">
            <div className="feature-icon blue">
              <Video />
            </div>
            <h3>{t("feat_hd_title")}</h3>
            <p>{t("feat_hd_desc")}</p>
          </article>
          <article className="feature-card">
            <div className="feature-icon violet">
              <MonitorUp />
            </div>
            <h3>{t("feat_screen_title")}</h3>
            <p>{t("feat_screen_desc")}</p>
          </article>
          <article className="feature-card">
            <div className="feature-icon cyan">
              <MessageSquare />
            </div>
            <h3>{t("feat_chat_title")}</h3>
            <p>{t("feat_chat_desc")}</p>
          </article>
          <article className="feature-card">
            <div className="feature-icon green">
              <Zap />
            </div>
            <h3>{t("feat_fast_title")}</h3>
            <p>{t("feat_fast_desc")}</p>
          </article>
        </div>
      </section>

      <section className="bottom-cta container" id="about">
        <div>
          <div className="eyebrow">YOUR NEXT MEETING STARTS HERE</div>
          <h2>
            Bring everyone
            <br />
            into the room.
          </h2>
        </div>
        <Link className="button primary" to={user ? "/dashboard" : "/auth"}>
          {t("nav_getstarted")} <ArrowRight size={18} />
        </Link>
      </section>

      <footer className="footer container">
        <Brand small />
        <span>© {new Date().getFullYear()} AuraClave. Made for meaningful conversations.</span>
        <span className="footer-status">
          <Check size={14} /> All systems ready
        </span>
      </footer>
    </div>
  );
}
