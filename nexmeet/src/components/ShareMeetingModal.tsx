import { useState } from "react";
import { X, Copy, Check, Share2, MessageCircle, Link as LinkIcon, ShieldCheck } from "lucide-react";

interface ShareMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomName: string;
}

export default function ShareMeetingModal({ isOpen, onClose, roomName }: ShareMeetingModalProps) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);

  if (!isOpen) return null;

  const meetingUrl = `${window.location.origin}/meeting/${roomName}`;
  const inviteMessage = `Hey! Join my AuraClave video meeting.\n\nRoom: ${roomName}\nLink: ${meetingUrl}`;

  const copyToClipboard = async (text: string, type: "link" | "invite") => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === "link") {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      } else {
        setCopiedInvite(true);
        setTimeout(() => setCopiedInvite(false), 2000);
      }
    } catch (err) {
      console.error("Clipboard copy failed:", err);
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Join my AuraClave Meeting",
          text: `Join meeting room: ${roomName}`,
          url: meetingUrl
        });
      } catch {
        // User cancelled share
      }
    }
  };

  const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(inviteMessage)}`;

  return (
    <div className="profile-modal-backdrop" onClick={onClose}>
      <div className="profile-modal share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="profile-modal-header">
          <div className="flex items-center gap-2">
            <Share2 size={18} className="text-violet-400" />
            <h3>Share Meeting</h3>
          </div>
          <button className="icon-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="share-modal-body">
          <p className="muted small">
            Anyone with this link or room code can join this AuraClave meeting.
          </p>

          {/* Meeting URL Box */}
          <div className="share-field">
            <label>Meeting Link</label>
            <div className="share-input-row">
              <div className="share-url-text">
                <LinkIcon size={15} />
                <span>{meetingUrl}</span>
              </div>
              <button
                className={`button ${copiedLink ? "secondary" : "primary"} small`}
                onClick={() => copyToClipboard(meetingUrl, "link")}
              >
                {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                {copiedLink ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          {/* Room Code Box */}
          <div className="share-field">
            <label>Room Code</label>
            <div className="room-code-badge">
              <code>{roomName}</code>
            </div>
          </div>

          {/* Quick Share Buttons */}
          <div className="quick-share-grid">
            <button
              type="button"
              className="quick-share-btn"
              onClick={() => copyToClipboard(inviteMessage, "invite")}
            >
              {copiedInvite ? <Check size={16} color="#22c55e" /> : <Copy size={16} />}
              <span>{copiedInvite ? "Invite Copied!" : "Copy Full Invite"}</span>
            </button>

            <a
              href={whatsappUrl}
              target="_blank"
              rel="noreferrer"
              className="quick-share-btn whatsapp"
            >
              <MessageCircle size={16} />
              <span>Share via WhatsApp</span>
            </a>

            {typeof navigator !== "undefined" && "share" in navigator && (
              <button
                type="button"
                className="quick-share-btn native"
                onClick={handleNativeShare}
              >
                <Share2 size={16} />
                <span>Share to Apps</span>
              </button>
            )}
          </div>

          <div className="privacy-badge">
            <ShieldCheck size={15} color="#22c55e" />
            <span>End-to-end WebRTC encryption. Only participants with the link can join.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
