import { useState, useEffect, useCallback } from "react";
import { X, Bell, AlertCircle, MessageSquare, BookOpen, CheckCircle } from "lucide-react";

export type NotificationType = "info" | "warning" | "error" | "success" | "escalation";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  actionUrl?: string;
  sound?: boolean;
}

interface NotificationCenterProps {
  onNotification?: (notification: Notification) => void;
}

export function NotificationCenter({ onNotification }: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showCenter, setShowCenter] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Play notification sound
  const playNotificationSound = useCallback((type: NotificationType) => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    const frequencies: Record<NotificationType, number> = {
      info: 800,
      warning: 1000,
      error: 600,
      success: 1200,
      escalation: 1500,
    };

    oscillator.frequency.value = frequencies[type];
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  }, []);

  // Add notification
  const addNotification = useCallback(
    (notification: Omit<Notification, "id" | "timestamp" | "read">) => {
      const newNotification: Notification = {
        ...notification,
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date(),
        read: false,
      };

      setNotifications((prev) => [newNotification, ...prev]);
      setUnreadCount((prev) => prev + 1);

      if (notification.sound !== false) {
        playNotificationSound(notification.type);
      }

      onNotification?.(newNotification);

      // Auto-dismiss after 5 seconds for non-critical notifications
      if (notification.type !== "escalation" && notification.type !== "error") {
        setTimeout(() => {
          removeNotification(newNotification.id);
        }, 5000);
      }
    },
    [playNotificationSound, onNotification]
  );

  // Remove notification
  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Mark as read
  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, read: true } : n
      )
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
  }, []);

  // Clear all
  const clearAll = useCallback(() => {
    setNotifications([]);
    setUnreadCount(0);
  }, []);

  // Expose methods globally for backend integration
  useEffect(() => {
    (window as any).adamNotifications = {
      add: addNotification,
      remove: removeNotification,
      markAsRead,
      clearAll,
    };
  }, [addNotification, removeNotification, markAsRead, clearAll]);

  const getIcon = (type: NotificationType) => {
    const iconProps = "h-4 w-4";
    switch (type) {
      case "escalation":
        return <AlertCircle className={`${iconProps} text-red-400`} />;
      case "warning":
        return <AlertCircle className={`${iconProps} text-yellow-400`} />;
      case "error":
        return <AlertCircle className={`${iconProps} text-red-500`} />;
      case "success":
        return <CheckCircle className={`${iconProps} text-green-400`} />;
      default:
        return <MessageSquare className={`${iconProps} text-blue-400`} />;
    }
  };

  const getBackgroundColor = (type: NotificationType) => {
    switch (type) {
      case "escalation":
        return "bg-red-500/10 border-red-500/30";
      case "warning":
        return "bg-yellow-500/10 border-yellow-500/30";
      case "error":
        return "bg-red-500/10 border-red-500/30";
      case "success":
        return "bg-green-500/10 border-green-500/30";
      default:
        return "bg-blue-500/10 border-blue-500/30";
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-40 space-y-3">
      {/* Toast notifications (first 3) */}
      {notifications.slice(0, 3).map((notification) => (
        <div
          key={notification.id}
          className={`w-80 border rounded-lg p-3 backdrop-blur-sm ${getBackgroundColor(
            notification.type
          )} animate-in slide-in-from-right`}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5">{getIcon(notification.type)}</div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-mono text-white/90 font-semibold">
                {notification.title}
              </h4>
              <p className="text-xs text-white/60 font-mono mt-1">
                {notification.message}
              </p>
              {notification.actionUrl && (
                <a
                  href={notification.actionUrl}
                  className="text-xs text-primary hover:text-primary/80 font-mono mt-2 inline-block"
                >
                  Visualizza →
                </a>
              )}
            </div>
            <button
              onClick={() => removeNotification(notification.id)}
              className="text-white/30 hover:text-white/60 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}

      {/* Notification center button */}
      <button
        onClick={() => setShowCenter(!showCenter)}
        className="relative w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all"
      >
        <Bell className="h-5 w-5 text-white/60" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 w-5 h-5 bg-red-500 rounded-full text-[10px] font-mono text-white flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Notification center panel */}
      {showCenter && (
        <div className="fixed bottom-24 right-6 w-96 max-h-96 bg-white/5 border border-white/10 rounded-lg backdrop-blur-sm flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-white/5">
            <h3 className="text-sm font-mono text-white/70">Notifiche</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={() => {
                    notifications.forEach((n) => {
                      if (!n.read) markAsRead(n.id);
                    });
                  }}
                  className="text-[10px] text-primary hover:text-primary/80 font-mono"
                >
                  Segna tutto come letto
                </button>
              )}
              <button
                onClick={() => setShowCenter(false)}
                className="text-white/30 hover:text-white/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-4 text-center text-white/30 text-[10px] font-mono">
                Nessuna notifica
              </div>
            ) : (
              <div className="space-y-1">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    onClick={() => {
                      if (!notification.read) markAsRead(notification.id);
                      if (notification.actionUrl) {
                        window.location.href = notification.actionUrl;
                      }
                    }}
                    className={`p-3 border-b border-white/5 cursor-pointer hover:bg-white/5 transition-all ${
                      !notification.read ? "bg-white/[0.03]" : ""
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5">{getIcon(notification.type)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-xs font-mono text-white/80 font-semibold">
                            {notification.title}
                          </h4>
                          {!notification.read && (
                            <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-[10px] text-white/50 font-mono mt-1">
                          {notification.message}
                        </p>
                        <span className="text-[8px] text-white/30 font-mono mt-1 block">
                          {notification.timestamp.toLocaleTimeString("it-IT")}
                        </span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeNotification(notification.id);
                        }}
                        className="text-white/20 hover:text-white/50 flex-shrink-0"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {notifications.length > 0 && (
            <div className="border-t border-white/5 p-2">
              <button
                onClick={clearAll}
                className="w-full text-[10px] text-white/40 hover:text-white/60 font-mono py-1"
              >
                Cancella tutto
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
