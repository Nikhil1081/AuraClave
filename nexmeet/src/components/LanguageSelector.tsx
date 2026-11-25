import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Globe, ChevronDown } from "lucide-react";
import { useLanguage, SUPPORTED_LANGUAGES } from "../contexts/LanguageContext";

export default function LanguageSelector({
  compact = false,
  dropUp = false
}: {
  compact?: boolean;
  dropUp?: boolean;
}) {
  const { language, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const portalMenuRef = useRef<HTMLDivElement>(null);

  const currentLang = SUPPORTED_LANGUAGES.find((l) => l.code === language) || SUPPORTED_LANGUAGES[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      const inTrigger = dropdownRef.current?.contains(target);
      const inPortal = portalMenuRef.current?.contains(target);
      if (!inTrigger && !inPortal) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open || !dropUp || !buttonRef.current) return;
    const updatePosition = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const menuWidth = 220;
      const center = rect.left + rect.width / 2;
      const clampedLeft = Math.max(12, Math.min(window.innerWidth - menuWidth - 12, center - menuWidth / 2));
      setMenuPos({
        left: clampedLeft,
        bottom: window.innerHeight - rect.top + 12
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [open, dropUp]);

  const dropdownContent = (
    <div
      ref={portalMenuRef}
      className="lang-dropdown"
      style={
        dropUp && menuPos
          ? {
              position: "fixed",
              left: `${menuPos.left}px`,
              bottom: `${menuPos.bottom}px`,
              top: "auto",
              right: "auto",
              transform: "none",
              zIndex: 9999
            }
          : undefined
      }
    >
      <div className="lang-dropdown-header">Select Language / भाषा</div>
      <div className="lang-list">
        {SUPPORTED_LANGUAGES.map((item) => (
          <button
            key={item.code}
            type="button"
            className={`lang-option ${language === item.code ? "selected" : ""}`}
            onClick={() => {
              setLanguage(item.code);
              setOpen(false);
            }}
          >
            <span className="native">{item.nativeName}</span>
            <span className="label">({item.label})</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="language-selector-wrap" ref={dropdownRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`lang-btn ${compact ? "compact" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        title="Select Language / भाषा चुनें"
        aria-label={`Select language (${currentLang.label})`}
        aria-expanded={open}
      >
        <Globe size={18} color="#8ba6ff" />
        <span className="lang-name">
          {compact ? currentLang.code.toUpperCase() : currentLang.nativeName}
        </span>
        {!dropUp && <ChevronDown size={13} className={`arrow ${open ? "rotated" : ""}`} />}
      </button>

      {open && (dropUp ? createPortal(dropdownContent, document.body) : dropdownContent)}
    </div>
  );
}
