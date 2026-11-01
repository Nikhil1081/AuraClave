export default function Brand({
  small = false,
  showTagline = false
}: {
  small?: boolean;
  showTagline?: boolean;
}) {
  return (
    <div className={`brand ${small ? "brand-small" : ""}`}>
      <span className="brand-mark-wrap">
        <img
          src="/assets/app-icon-clean.png"
          alt="AuraClave Logo"
          className="brand-logo-img"
        />
      </span>
      <div className="brand-text-col">
        <span className="brand-title">
          Aura<span className="brand-accent">Clave</span>
        </span>
        {showTagline && (
          <span className="brand-tagline">Connect Without Limits.</span>
        )}
      </div>
    </div>
  );
}
