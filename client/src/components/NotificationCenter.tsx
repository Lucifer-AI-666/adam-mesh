import { Bell, X, Trash2, CheckCheck, Settings, AlertTriangle, MessageSquare, BookOpen, Info } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useNotifications, type NotificationType, type AppNotification } from "@/contexts/NotificationContext";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const TYPE_CONFIG: Record<
  NotificationType,
  { label: string; Icon: React.ElementType; color: string }
> = {
  escalation_red: {
    label: "Escalation rossa",
    Icon: AlertTriangle,
    color: "text-red-400",
  },
  new_message: {
    label: "Nuovi messaggi",
    Icon: MessageSquare,
    color: "text-primary",
  },
  knowledge_update: {
    label: "Knowledge base",
    Icon: BookOpen,
    color: "text-amber-400",
  },
  system: {
    label: "Sistema",
    Icon: Info,
    color: "text-blue-400",
  },
};

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "adesso";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m fa`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h fa`;
  return `${Math.floor(hours / 24)}g fa`;
}

function NotificationItem({ notification, onDismiss }: { notification: AppNotification; onDismiss: (id: string) => void }) {
  const { Icon, color } = TYPE_CONFIG[notification.type];
  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors group",
        !notification.read && "bg-white/[0.03]"
      )}
    >
      <div className={cn("mt-0.5 shrink-0", color)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("text-xs font-mono font-medium truncate", notification.read ? "text-white/50" : "text-white/80")}>
            {notification.title}
          </p>
          <span className="text-[9px] text-white/30 shrink-0 mt-0.5">{timeAgo(notification.createdAt)}</span>
        </div>
        <p className="text-[10px] text-white/40 font-mono mt-0.5 line-clamp-2">{notification.message}</p>
      </div>
      <button
        onClick={() => onDismiss(notification.id)}
        className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 hover:text-white/70 text-white/30 transition-all"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export default function NotificationCenter() {
  const { notifications, unreadCount, preferences, markAllRead, clearAll, dismissNotification, updatePreferences } =
    useNotifications();
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleOpen = () => {
    setOpen((prev) => !prev);
    setShowSettings(false);
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={handleOpen}
        className="relative flex items-center justify-center h-8 w-8 rounded-md hover:bg-white/10 transition-colors text-white/50 hover:text-white/90"
        aria-label="Centro notifiche"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-10 w-80 bg-[#080818] border border-white/10 rounded-lg shadow-2xl z-50 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Bell className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-mono font-semibold text-white/80">Notifiche</span>
              {unreadCount > 0 && (
                <span className="text-[9px] bg-primary/20 text-primary rounded-full px-1.5 py-0.5 font-mono">
                  {unreadCount} nuove
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  title="Segna tutto come letto"
                  className="p-1 hover:bg-white/10 rounded text-white/40 hover:text-white/70 transition-colors"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  title="Elimina tutto"
                  className="p-1 hover:bg-white/10 rounded text-white/40 hover:text-white/70 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={() => setShowSettings((s) => !s)}
                title="Preferenze"
                className={cn(
                  "p-1 hover:bg-white/10 rounded transition-colors",
                  showSettings ? "text-primary" : "text-white/40 hover:text-white/70"
                )}
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Settings panel */}
          {showSettings && (
            <div className="border-b border-white/5 px-4 py-3 space-y-2.5 bg-white/[0.02]">
              <p className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-2">Preferenze</p>
              {(Object.keys(TYPE_CONFIG) as NotificationType[]).map((type) => {
                const { label, Icon, color } = TYPE_CONFIG[type];
                return (
                  <div key={type} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className={cn("h-3 w-3", color)} />
                      <span className="text-[10px] font-mono text-white/60">{label}</span>
                    </div>
                    <Switch
                      checked={preferences[type]}
                      onCheckedChange={(checked) => updatePreferences({ [type]: checked })}
                      className="scale-75 origin-right"
                    />
                  </div>
                );
              })}
              <div className="flex items-center justify-between pt-1 border-t border-white/5">
                <span className="text-[10px] font-mono text-white/60">Suono escalation</span>
                <Switch
                  checked={preferences.sound}
                  onCheckedChange={(checked) => updatePreferences({ sound: checked })}
                  className="scale-75 origin-right"
                />
              </div>
            </div>
          )}

          {/* Notifications list */}
          <div className="overflow-y-auto max-h-72">
            {notifications.length === 0 ? (
              <div className="py-10 text-center">
                <Bell className="h-8 w-8 mx-auto text-white/10 mb-2" />
                <p className="text-xs font-mono text-white/30">Nessuna notifica</p>
              </div>
            ) : (
              notifications.map((n) => (
                <NotificationItem key={n.id} notification={n} onDismiss={dismissNotification} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
