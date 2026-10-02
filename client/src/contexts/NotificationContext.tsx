import { createContext, useCallback, useContext, useRef, useState } from "react";

export type NotificationType = "escalation_red" | "new_message" | "knowledge_update" | "system";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAt: Date;
}

export interface NotificationPreferences {
  escalation_red: boolean;
  new_message: boolean;
  knowledge_update: boolean;
  system: boolean;
  sound: boolean;
}

const DEFAULT_PREFS: NotificationPreferences = {
  escalation_red: true,
  new_message: true,
  knowledge_update: true,
  system: true,
  sound: true,
};

const PREFS_KEY = "adam_notification_prefs";
const MAX_NOTIFICATIONS = 50;
export const NOTIFICATION_MESSAGE_MAX_LENGTH = 120;

interface NotificationContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  preferences: NotificationPreferences;
  addNotification: (type: NotificationType, title: string, message: string) => void;
  dismissNotification: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
  updatePreferences: (prefs: Partial<NotificationPreferences>) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

function loadPrefs(): NotificationPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_PREFS;
}

function playAlertBeep(audioContextRef: React.MutableRefObject<AudioContext | null>) {
  try {
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContext();
    }
    const ctx = audioContextRef.current;
    if (ctx.state === "suspended") ctx.resume();

    const playTone = (freq: number, startTime: number, duration: number, gain: number) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = ctx.currentTime;
    playTone(880, now, 0.3, 0.4);
    playTone(660, now + 0.3, 0.3, 0.35);
    playTone(880, now + 0.6, 0.4, 0.45);
  } catch (err) {
    console.warn("[Notification] Could not play alert sound:", err);
  }
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreferences>(loadPrefs);
  const audioContextRef = useRef<AudioContext | null>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const addNotification = useCallback(
    (type: NotificationType, title: string, message: string) => {
      if (!preferences[type]) return;

      const notification: AppNotification = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type,
        title,
        message,
        read: false,
        createdAt: new Date(),
      };

      setNotifications((prev) => [notification, ...prev].slice(0, MAX_NOTIFICATIONS));

      if (type === "escalation_red" && preferences.sound) {
        playAlertBeep(audioContextRef);
      }
    },
    [preferences]
  );

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const updatePreferences = useCallback((prefs: Partial<NotificationPreferences>) => {
    setPreferences((prev) => {
      const next = { ...prev, ...prefs };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        preferences,
        addNotification,
        dismissNotification,
        markAllRead,
        clearAll,
        updatePreferences,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}
