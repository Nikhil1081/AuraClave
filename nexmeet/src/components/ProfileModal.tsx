import { useState, useRef, type ChangeEvent } from "react";
import { X, Upload, Check, User, Camera, Sparkles } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

const PRESET_AVATARS = [
  "https://api.dicebear.com/7.x/bottts/svg?seed=Aura1",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Clave2",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Nikhil3",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Tech4",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Felix",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka"
];

export default function ProfileModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { user, updateProfile } = useAuth();
  const [fullName, setFullName] = useState(user?.user_metadata?.full_name || "");
  const [avatarUrl, setAvatarUrl] = useState(user?.user_metadata?.avatar_url || "");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please select a valid image file.");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setError("Image must be smaller than 8MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const rawDataUrl = event.target?.result as string;
      const img = new Image();
      img.onload = () => {
        try {
          // Resize & square crop to 160x160 for optimal avatar performance
          const canvas = document.createElement("canvas");
          canvas.width = 160;
          canvas.height = 160;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            setAvatarUrl(rawDataUrl);
            setError("");
            return;
          }

          // Center crop calculation
          const size = Math.min(img.width, img.height);
          const startX = (img.width - size) / 2;
          const startY = (img.height - size) / 2;

          ctx.drawImage(img, startX, startY, size, size, 0, 0, 160, 160);
          const compressed = canvas.toDataURL("image/jpeg", 0.85);
          setAvatarUrl(compressed);
          setError("");
        } catch {
          setAvatarUrl(rawDataUrl);
          setError("");
        }
      };
      img.onerror = () => {
        setError("Failed to load image preview.");
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await updateProfile(fullName, avatarUrl);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1000);
    } catch (err: any) {
      setError(err?.message || "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

  const initial = (fullName.trim() || user?.email || "U")[0].toUpperCase();

  return (
    <div className="profile-modal-backdrop" onClick={onClose}>
      <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="profile-modal-header">
          <div className="flex items-center gap-2">
            <User size={18} className="text-violet-400" />
            <h3>Edit Profile & DP</h3>
          </div>
          <button className="icon-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave} className="profile-form">
          {/* Avatar Preview & Upload */}
          <div className="avatar-section">
            <div className="avatar-preview-wrap">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Profile DP" className="avatar-preview-img" />
              ) : (
                <div className="avatar-preview-fallback">{initial}</div>
              )}
              <button
                type="button"
                className="avatar-change-badge"
                onClick={() => fileInputRef.current?.click()}
                title="Upload Photo"
              >
                <Camera size={14} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                style={{ display: "none" }}
                onChange={handleFileUpload}
              />
            </div>
            <div className="avatar-actions">
              <button
                type="button"
                className="button secondary small"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={14} /> Upload DP
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  className="button text-btn small"
                  onClick={() => setAvatarUrl("")}
                >
                  Remove DP
                </button>
              )}
            </div>
          </div>

          {/* Preset Avatars */}
          <div className="preset-row">
            <span className="preset-label">
              <Sparkles size={13} /> Or choose a preset:
            </span>
            <div className="preset-list">
              {PRESET_AVATARS.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`preset-btn ${avatarUrl === preset ? "selected" : ""}`}
                  onClick={() => setAvatarUrl(preset)}
                >
                  <img src={preset} alt={`Preset ${idx + 1}`} />
                </button>
              ))}
            </div>
          </div>

          {/* Username Field */}
          <div className="field-group">
            <label>Username / Display Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Nikhil Vankala"
              required
              minLength={2}
              maxLength={40}
            />
          </div>

          {/* Email (Readonly) */}
          <div className="field-group">
            <label>Email Address</label>
            <input type="email" value={user?.email || ""} disabled className="disabled-input" />
          </div>

          {error && <div className="notice error">{error}</div>}
          {success && (
            <div className="notice success">
              <Check size={16} /> Profile and DP updated!
            </div>
          )}

          <div className="profile-modal-footer">
            <button type="button" className="button secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={saving}>
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
