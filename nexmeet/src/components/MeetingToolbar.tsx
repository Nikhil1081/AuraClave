import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Share2,
  ScreenShare,
  ScreenShareOff,
  MessageSquare,
  MessageSquareOff,
  LogOut,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface Props {
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  chatOpen: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onToggleChat: () => void;
  onLeave: () => void;
}

export const MeetingToolbar: React.FC<Props> = ({
  micOn,
  camOn,
  screenOn,
  chatOpen,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onToggleChat,
  onLeave,
}) => {
  const THRESHOLD = 800; // px width to switch to compact mode
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // responsive width observer
  useEffect(() => {
    if (!toolbarRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      setCompact(w < THRESHOLD);
    });
    ro.observe(toolbarRef.current);
    return () => ro.disconnect();
  }, []);

  const renderBtn = (
    IconOn: any,
    IconOff: any,
    active: boolean,
    label: string,
    onClick: () => void,
    ariaLabel: string,
  ) => {
    const Icon = active ? IconOn : IconOff;
    return (
      <button
        onClick={onClick}
        className={`flex items-center justify-center rounded-lg ${compact ? 'p-2' : 'p-3'} hover:bg-gray-700 transition-colors`}
        aria-label={ariaLabel}
        title={compact ? undefined : label}
        tabIndex={collapsed ? -1 : 0}
      >
        <Icon size={compact ? 20 : 24} className="text-white" />
        {!compact && <span className="mt-1 text-sm">{label}</span>}
      </button>
    );
  };

  return (
    <div className="relative">
      {/* Collapse/expand handle */}
      <div className="absolute inset-x-0 top-[-1.5rem] flex justify-center">
        {collapsed ? (
          <button
            onClick={() => setCollapsed(false)}
            className="p-1 rounded-full bg-gray-800 hover:bg-gray-700"
            aria-label="Expand meeting toolbar"
          >
            <ChevronUp size={20} className="text-white" />
          </button>
        ) : (
          <button
            onClick={() => setCollapsed(true)}
            className="p-1 rounded-full bg-gray-800 hover:bg-gray-700"
            aria-label="Collapse meeting toolbar"
          >
            <ChevronDown size={20} className="text-white" />
          </button>
        )}
      </div>

      {/* Toolbar visible when not collapsed */}
      {!collapsed && (
        <div
          ref={toolbarRef}
          className={`flex overflow-x-auto gap-2 justify-center ${compact ? 'py-1' : 'py-2'} bg-gray-800 rounded-t-lg transition-height duration-300`}
        >
          {renderBtn(Mic, MicOff, micOn, 'Mute', onToggleMic, 'Toggle microphone')}
          {renderBtn(Video, VideoOff, camOn, 'Camera', onToggleCamera, 'Toggle camera')}
          {renderBtn(ScreenShare, ScreenShareOff, screenOn, 'Screen', onToggleScreenShare, 'Toggle screen share')}
          {renderBtn(MessageSquare, MessageSquareOff, chatOpen, 'Chat', onToggleChat, 'Toggle chat')}
          <button
            onClick={onLeave}
            className={`flex items-center justify-center rounded-lg ${compact ? 'p-2' : 'p-3'} bg-red-600 hover:bg-red-500 transition-colors`}
            aria-label="Leave meeting"
            title={compact ? undefined : 'Leave'}
            tabIndex={-1}
          >
            <LogOut size={compact ? 20 : 24} className="text-white" />
            {!compact && <span className="mt-1 text-sm">Leave</span>}
          </button>
        </div>
      )}
    </div>
  );
};
