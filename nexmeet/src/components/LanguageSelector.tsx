import { useState, useRef, useEffect } from "react";
import { Globe, ChevronDown } from "lucide-react";
import { useLanguage, SUPPORTED_LANGUAGES, type LanguageCode } from "../contexts/LanguageContext";

export default function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentLang = SUPPORTED_LANGUAGES.find((l) => l.code === language) || SUPPORTED_LANGUAGES[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="language-selector-wrap" ref={dropdownRef}>
      <button
        type="button"
        className={`lang-btn ${compact ? "compact" : ""}`}
        onClick={() => setOpen(!open)}
        title="Select Language / भाषा चुनें"
      >
        <Globe size={15} color="#8ba6ff" />
        <span className="lang-name">{compact ? currentLang.code.toUpperCase() : currentLang.nativeName}</span>
        <ChevronDown size={13} className={`arrow ${open ? "rotated" : ""}`} />
      </button>

      {open && (
        <div className="lang-dropdown">
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
      )}
    </div>
  );
}
