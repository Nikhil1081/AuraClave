import { Link } from "react-router-dom";
import {
  ArrowRight,
  AudioLines,
  Bot,
  Check,
  Disc,
  Languages,
  Video
} from "lucide-react";
import Brand from "../components/Brand";
import LanguageSelector from "../components/LanguageSelector";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../contexts/LanguageContext";

export default function Home() {
  const { user } = useAuth();
  const { t } = useLanguage();

  return (
    <div className="marketing">
      {/* Navigation */}
      <nav className="nav container">
        <Brand showTagline />
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

      {/* Hero Section */}
      <section className="hero container">
        <div className="hero-copy">
          <div className="pill">
            <span className="status-dot" /> {t("hero_pill")}
          </div>

          <h1>
            {t("hero_title_1")}
            <br />
            <span className="gradient-highlight">{t("hero_title_2")}</span>
          </h1>

          <p className="hero-description">{t("hero_desc")}</p>

          {/* 4 Feature Badges from the Image */}
          <div className="hero-feature-ribbon">
            <div className="ribbon-item">
              <div className="ribbon-icon">
                <Video size={17} />
              </div>
              <span>{t("badge_video")}</span>
            </div>
            <div className="ribbon-divider" />
            <div className="ribbon-item">
              <div className="ribbon-icon">
                <Languages size={17} />
              </div>
              <span>{t("badge_subtitles")}</span>
            </div>
            <div className="ribbon-divider" />
            <div className="ribbon-item">
              <div className="ribbon-icon">
                <Bot size={17} />
              </div>
              <span>{t("badge_ai")}</span>
            </div>
            <div className="ribbon-divider" />
            <div className="ribbon-item">
              <div className="ribbon-icon">
                <Disc size={17} />
              </div>
              <span>{t("badge_recording")}</span>
            </div>
          </div>

          <div className="hero-actions">
            <Link className="button primary" to={user ? "/dashboard" : "/auth"}>
              {t("hero_start")} <ArrowRight size={18} />
            </Link>
            <a className="button secondary" href="#demo">
              {t("hero_explore")}
            </a>
          </div>

          <div className="hero-trust">
            <div className="avatar-stack">
              <i>A</i>
              <i>N</i>
              <i>J</i>
              <i>+</i>
            </div>
            <span>{t("hero_built")}</span>
          </div>
        </div>

        {/* Hero Visual Mockup from the Picture */}
        <div className="hero-art hero-art-aurora">
          <div className="art-glow" />

          <div className="laptop-showcase-wrap">
            {/* Laptop Device */}
            <div className="laptop-device">
              <div className="laptop-screen">
                <div className="laptop-webcam">
                  <span className="cam-dot" />
                  <span className="cam-light" />
                </div>

                <div className="laptop-meeting-grid">
                  <div className="laptop-video-tile tile-1">
                    <img
                      src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&q=80"
                      alt="Alex"
                      className="tile-img"
                      loading="lazy"
                    />
                    <div className="tile-name">Alex Morgan</div>
                    <div className="tile-speaking-indicator">
                      <AudioLines size={12} />
                    </div>
                  </div>
                  <div className="laptop-video-tile tile-2">
                    <img
                      src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80"
                      alt="Sam"
                      className="tile-img"
                      loading="lazy"
                    />
                    <div className="tile-name">Sam Kim</div>
                  </div>
                  <div className="laptop-video-tile tile-3">
                    <img
                      src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80"
                      alt="Jamie"
                      className="tile-img"
                      loading="lazy"
                    />
                    <div className="tile-name">Jamie Reed</div>
                  </div>
                  <div className="laptop-video-tile tile-4">
                    <img
                      src="https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=400&q=80"
                      alt="Priya"
                      className="tile-img"
                      loading="lazy"
                    />
                    <div className="tile-name">Priya Sharma</div>
                  </div>
                </div>

                {/* Live Captions Floating Pill on Laptop Bottom */}
                <div className="laptop-captions-pill">
                  <span className="cc-badge">CC</span>
                  <div className="captions-text-wrap">
                    <b>{t("live_captions_title")}</b>
                    <span className="captions-scripts">हिन्दी · తెలుగు · தமிழ் · বাংলা · ...</span>
                  </div>
                </div>
              </div>

              {/* Laptop Keyboard Base */}
              <div className="laptop-base">
                <div className="laptop-notch" />
              </div>
            </div>

            {/* Floating Glass AI Summary Card (Right side) */}
            <div className="floating-ai-card">
              <div className="ai-card-glow" />
              <div className="ai-card-header">
                <img
                  src="/assets/app-icon-clean.png"
                  alt="AuraClave"
                  className="ai-card-logo"
                />
                <span className="ai-card-title">{t("ai_summary_title")}</span>
              </div>
              <ul className="ai-card-items">
                <li>
                  <span className="check-badge">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span>{t("ai_item_1")}</span>
                </li>
                <li>
                  <span className="check-badge">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span>{t("ai_item_2")}</span>
                </li>
                <li>
                  <span className="check-badge">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span>{t("ai_item_3")}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Strip Section with 4 Pillars */}
      <section className="feature-strip container" id="features">
        <div className="section-heading">
          <div className="eyebrow">MADE FOR MOMENTUM</div>
          <h2>
            Everything clicks
            <br />
            when you connect.
          </h2>
          <p>Simple tools that keep your team in the conversation across every language.</p>
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
              <Languages />
            </div>
            <h3>{t("feat_screen_title")}</h3>
            <p>{t("feat_screen_desc")}</p>
          </article>
          <article className="feature-card">
            <div className="feature-icon cyan">
              <Bot />
            </div>
            <h3>{t("feat_chat_title")}</h3>
            <p>{t("feat_chat_desc")}</p>
          </article>
          <article className="feature-card">
            <div className="feature-icon green">
              <Disc />
            </div>
            <h3>{t("feat_fast_title")}</h3>
            <p>{t("feat_fast_desc")}</p>
          </article>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bottom-cta container" id="about">
        <div>
          <div className="eyebrow">CONNECT WITHOUT LIMITS</div>
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

      {/* Footer */}
      <footer className="footer container">
        <Brand small showTagline />
        <span>© {new Date().getFullYear()} AuraClave. Made for meaningful conversations.</span>
        <span className="footer-status">
          <Check size={14} /> All systems ready
        </span>
      </footer>
    </div>
  );
}
