import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, Bell, CheckCircle, MessageSquare, X } from "lucide-react";

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

type NewNotification = Omit<Notification, "id" | "timestamp" | "read">;

interface NotificationContextValue {
  notifications: Notification[];
  toastIds: string[];
  unreadCount: number;
  addNotification: (notification: NewNotification) => void;
  dismissToast: (id: string) => void;
  removeNotification: (id: string) => void;
  markAsRead: (id: string) => void;
  clearAll: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("NotificationCenterControl must be used within NotificationCenterProvider");
  }
  return context;
}

export function NotificationCenterProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toastIds, setToastIds] = useState<string[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const toastTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const removeNotification = useCallback((id: string) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) clearTimeout(timer);
    toastTimersRef.current.delete(id);
    setNotifications((previous) => previous.filter((notification) => notification.id !== id));
    setToastIds((previous) => previous.filter((toastId) => toastId !== id));
  }, []);

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) clearTimeout(timer);
    toastTimersRef.current.delete(id);
    setToastIds((previous) => previous.filter((toastId) => toastId !== id));
  }, []);

  const playNotificationSound = useCallback((type: NotificationType) => {
    const AudioContextConstructor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;

    const audioContext = audioContextRef.current ?? new AudioContextConstructor();
    audioContextRef.current = audioContext;

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const frequencies: Record<NotificationType, number> = {
      info: 800,
      warning: 1000,
      error: 600,
      success: 1200,
      escalation: 1500,
    };

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.frequency.value = frequencies[type];
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    oscillator.onended = () => {
      oscillator.disconnect();
      gainNode.disconnect();
    };
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.3);
  }, []);

  const addNotification = useCallback(
    (notification: NewNotification) => {
      const newNotification: Notification = {
        ...notification,
        id: Math.random().toString(36).slice(2, 11),
        timestamp: new Date(),
        read: false,
      };

      setNotifications((previous) => [newNotification, ...previous]);
      setToastIds((previous) => [newNotification.id, ...previous]);

      if (notification.sound !== false) playNotificationSound(notification.type);

      if (notification.type !== "escalation" && notification.type !== "error") {
        const timer = setTimeout(() => {
          setToastIds((previous) => previous.filter((id) => id !== newNotification.id));
          toastTimersRef.current.delete(newNotification.id);
        }, 5000);
        toastTimersRef.current.set(newNotification.id, timer);
      }
    },
    [playNotificationSound]
  );

  const markAsRead = useCallback((id: string) => {
    setNotifications((previous) =>
      previous.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification
      )
    );
  }, []);

  const clearAll = useCallback(() => {
    toastTimersRef.current.forEach((timer) => clearTimeout(timer));
    toastTimersRef.current.clear();
    setNotifications([]);
    setToastIds([]);
  }, []);

  useEffect(() => {
    const api = { add: addNotification, remove: removeNotification, markAsRead, clearAll };
    (window as any).adamNotifications = api;
    return () => {
      if ((window as any).adamNotifications === api) {
        delete (window as any).adamNotifications;
      }
      toastTimersRef.current.forEach((timer) => clearTimeout(timer));
      toastTimersRef.current.clear();
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, [addNotification, removeNotification, markAsRead, clearAll]);

  const unreadCount = notifications.filter((notification) => !notification.read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        toastIds,
        unreadCount,
        addNotification,
        dismissToast,
        removeNotification,
        markAsRead,
        clearAll,
      }}
    >
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-6 right-3 z-40 space-y-3 sm:right-6"
      >
        {toastIds.slice(0, 3).map((id) => {
          const notification = notifications.find((item) => item.id === id);
          if (!notification) return null;
          return (
            <div
              key={notification.id}
              role="status"
              className={`pointer-events-auto w-[calc(100vw-1.5rem)] max-w-80 rounded-lg border p-3 backdrop-blur-sm ${getBackgroundColor(
                notification.type
              )} animate-in slide-in-from-right`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{getIcon(notification.type)}</div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-mono font-semibold text-white/90">{notification.title}</h4>
                  <p className="mt-1 text-xs font-mono text-white/60">{notification.message}</p>
                  {notification.actionUrl && (
                    <a
                      href={notification.actionUrl}
                      className="mt-2 inline-block text-xs font-mono text-primary hover:text-primary/80"
                    >
                      Visualizza →
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Nascondi avviso"
                  onClick={() => dismissToast(notification.id)}
                  className="text-white/30 transition-colors hover:text-white/60"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </NotificationContext.Provider>
  );
}

export function NotificationCenterControl() {
  const { notifications, unreadCount, dismissToast, removeNotification, markAsRead, clearAll } =
    useNotifications();
  const [showCenter, setShowCenter] = useState(false);

  return (
    <div className="relative z-50 shrink-0">
      <button
        type="button"
        onClick={() => setShowCenter((visible) => !visible)}
        aria-label={`Apri notifiche${unreadCount ? `, ${unreadCount} non lette` : ""}`}
        aria-expanded={showCenter}
        aria-controls="adam-notification-center"
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 transition-all hover:bg-white/10"
      >
        <Bell className="h-5 w-5 text-white/60" />
        {unreadCount > 0 && (
          <span className="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-mono text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {showCenter && (
        <div
          id="adam-notification-center"
          role="dialog"
          aria-label="Centro notifiche"
          className="absolute left-0 top-full mt-2 flex max-h-[min(24rem,70vh)] w-[min(24rem,calc(100vw-1.5rem))] flex-col rounded-lg border border-white/10 bg-[#10101c] shadow-xl backdrop-blur-sm"
        >
          <div className="flex items-center justify-between border-b border-white/5 p-4">
            <h3 className="text-sm font-mono text-white/70">Notifiche</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => notifications.forEach((notification) => {
                    if (!notification.read) markAsRead(notification.id);
                  })}
                  className="text-[10px] font-mono text-primary hover:text-primary/80"
                >
                  Segna tutto come letto
                </button>
              )}
              <button
                type="button"
                aria-label="Chiudi centro notifiche"
                onClick={() => setShowCenter(false)}
                className="text-white/30 hover:text-white/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-4 text-center text-[10px] font-mono text-white/30">
                Nessuna notifica
              </div>
            ) : (
              <div className="space-y-1">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    onClick={() => {
                      if (!notification.read) markAsRead(notification.id);
                      if (notification.actionUrl) window.location.href = notification.actionUrl;
                    }}
                    className={`cursor-pointer border-b border-white/5 p-3 transition-all hover:bg-white/5 ${
                      !notification.read ? "bg-white/[0.03]" : ""
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5">{getIcon(notification.type)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-xs font-mono font-semibold text-white/80">
                            {notification.title}
                          </h4>
                          {!notification.read && (
                            <span aria-label="Non letta" className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                          )}
                        </div>
                        <p className="mt-1 text-[10px] font-mono text-white/50">{notification.message}</p>
                        <span className="mt-1 block text-[8px] font-mono text-white/30">
                          {notification.timestamp.toLocaleTimeString("it-IT")}
                        </span>
                      </div>
                      <button
                        type="button"
                        aria-label={`Elimina notifica: ${notification.title}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeNotification(notification.id);
                        }}
                        className="shrink-0 text-white/20 hover:text-white/50"
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
                type="button"
                onClick={clearAll}
                className="w-full py-1 text-[10px] font-mono text-white/40 hover:text-white/60"
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

function getIcon(type: NotificationType) {
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
}

function getBackgroundColor(type: NotificationType) {
  switch (type) {
    case "escalation":
    case "error":
      return "bg-red-500/10 border-red-500/30";
    case "warning":
      return "bg-yellow-500/10 border-yellow-500/30";
    case "success":
      return "bg-green-500/10 border-green-500/30";
    default:
      return "bg-blue-500/10 border-blue-500/30";
  }
}
