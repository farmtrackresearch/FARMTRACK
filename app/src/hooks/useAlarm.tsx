import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform, Vibration } from 'react-native';

import { ALARM_CHANNEL_ID, hasRegisteredPushToken } from '@/lib/pushNotifications';

export type AlarmSeverity = 'warning' | 'breach';

export type ActiveAlarm = {
  id: string;
  /** Who the alarm is for, usually a livestock id. One alarm per source. */
  sourceId: string;
  severity: AlarmSeverity;
  title: string;
  message: string;
  fenceName: string | null;
  startedAt: number;
  /** After this the sound and vibration stop; the overlay and notification stay. */
  soundUntil: number;
  silenced: boolean;
};

type TriggerOptions = {
  sourceId: string;
  severity: AlarmSeverity;
  title: string;
  message: string;
  fenceName?: string | null;
};

type AlarmContextValue = {
  /** All active alarms, most urgent first. */
  alarms: ActiveAlarm[];
  /** The alarm the overlay shows (most urgent, newest). */
  activeAlarm: ActiveAlarm | null;
  /** Starts (or updates the text of) the alarm for `sourceId`. Re-triggering never restarts the sound. */
  triggerAlarm: (opts: TriggerOptions) => string;
  /** Stops one source's alarm (user acknowledged it, or the server says it is over). */
  dismissAlarm: (sourceId: string) => void;
  /** Stops everything, e.g. on sign-out. */
  dismissAllAlarms: () => void;
};

const AlarmContext = createContext<AlarmContextValue | null>(null);

const ALARM_SOUND_MAX_MS = 5 * 60 * 1000;

const BREACH_PATTERN = [0, 500, 200, 500, 200, 500, 200, 800];
const WARNING_PATTERN = [0, 300, 150, 300];
const REPEAT_MS: Record<AlarmSeverity, number> = { breach: 2500, warning: 4000 };

const SAMPLE_RATE = 22050;

function generateToneWav(frequency: number, durationMs: number, volume = 0.85): string {
  const numSamples = Math.floor(SAMPLE_RATE * (durationMs / 1000));
  const bytesPerSample = 2;
  const byteRate = SAMPLE_RATE * bytesPerSample;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    const envelope = Math.min(1, i / 120) * Math.min(1, (numSamples - i) / 120);
    const sample = Math.sin(2 * Math.PI * frequency * t) * volume * envelope;
    view.setInt16(offset, Math.max(-1, Math.min(1, sample)) * 32767, true);
    offset += 2;
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(binary);
}

const WARNING_BEEP_WAV = generateToneWav(1400, 180, 0.8);
const BREACH_BEEP_WAV = generateToneWav(2000, 200, 0.9);

const notificationId = (sourceId: string) => `alarm-${sourceId}`;

function sortAlarms(list: ActiveAlarm[]): ActiveAlarm[] {
  return [...list].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'breach' ? -1 : 1;
    return b.startedAt - a.startedAt;
  });
}

async function postAlarmNotification(alarm: ActiveAlarm) {
  // With a registered push token the server delivers this alert itself (and
  // does so even when the app is closed); a local copy would just duplicate it.
  if (Platform.OS === 'web' || hasRegisteredPushToken()) return;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: notificationId(alarm.sourceId),
      content: { title: alarm.title, body: alarm.message, sound: true },
      trigger: Platform.OS === 'android' ? { channelId: ALARM_CHANNEL_ID } : null,
    });
  } catch (err) {
    console.warn('[AlarmProvider] local notification failed:', err);
  }
}

function clearAlarmNotification(sourceId: string) {
  if (Platform.OS === 'web') return;
  Notifications.dismissNotificationAsync(notificationId(sourceId)).catch(() => {});
}

export function AlarmProvider({ children }: { children: ReactNode }) {
  const [alarms, setAlarms] = useState<ActiveAlarm[]>([]);
  const alarmsRef = useRef<ActiveAlarm[]>([]);
  const playersRef = useRef<Map<AlarmSeverity, AudioPlayer>>(new Map());

  useEffect(() => {
    alarmsRef.current = alarms;
  }, [alarms]);

  // Audio setup only — notification permission is asked after login
  // (hooks/usePushRegistration.ts), not at launch.
  useEffect(() => {
    const players = playersRef.current;
    setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      // Foreground siren only. When the app is closed the server's push
      // notification (channel `alarms`) is what reaches the farmer.
      shouldPlayInBackground: false,
      interruptionMode: 'doNotMix',
    }).catch((err) => console.warn('[AlarmProvider] audio mode failed:', err));

    try {
      const warning = createAudioPlayer({ uri: WARNING_BEEP_WAV });
      warning.volume = 1.0;
      players.set('warning', warning);
      const breach = createAudioPlayer({ uri: BREACH_BEEP_WAV });
      breach.volume = 1.0;
      players.set('breach', breach);
    } catch (err) {
      console.warn('[AlarmProvider] audio preload failed:', err);
    }

    return () => {
      for (const player of players.values()) {
        try {
          player.remove();
        } catch {}
      }
      players.clear();
    };
  }, []);

  const playBurst = useCallback(async (severity: AlarmSeverity) => {
    Vibration.vibrate(severity === 'breach' ? BREACH_PATTERN : WARNING_PATTERN);
    const player = playersRef.current.get(severity);
    if (!player) return;
    const count = severity === 'breach' ? 3 : 1;
    for (let i = 0; i < count; i++) {
      try {
        await player.seekTo(0);
        player.play();
      } catch (err) {
        console.warn('[AlarmProvider] beep failed:', err);
        return;
      }
      if (i < count - 1) await new Promise((r) => setTimeout(r, 310));
    }
  }, []);

  // One sound loop for all alarms, at the most urgent severity still sounding.
  const soundingSeverity: AlarmSeverity | null = alarms.some((a) => !a.silenced && a.severity === 'breach')
    ? 'breach'
    : alarms.some((a) => !a.silenced)
      ? 'warning'
      : null;

  useEffect(() => {
    if (!soundingSeverity) return;
    const tick = () => {
      const now = Date.now();
      if (alarmsRef.current.some((a) => !a.silenced && a.soundUntil <= now)) {
        setAlarms((prev) => prev.map((a) => (!a.silenced && a.soundUntil <= now ? { ...a, silenced: true } : a)));
      }
      void playBurst(soundingSeverity);
    };
    tick();
    const id = setInterval(tick, REPEAT_MS[soundingSeverity]);
    const players = playersRef.current;
    return () => {
      clearInterval(id);
      Vibration.cancel();
      for (const player of players.values()) {
        try {
          player.pause();
        } catch {}
      }
    };
  }, [soundingSeverity, playBurst]);

  const triggerAlarm = useCallback((opts: TriggerOptions) => {
    const existing = alarmsRef.current.find((a) => a.sourceId === opts.sourceId);
    const now = Date.now();
    if (existing) {
      const escalated = existing.severity === 'warning' && opts.severity === 'breach';
      const updated: ActiveAlarm = {
        ...existing,
        severity: escalated ? 'breach' : existing.severity,
        title: opts.title,
        message: opts.message,
        fenceName: opts.fenceName ?? existing.fenceName,
        ...(escalated ? { startedAt: now, soundUntil: now + ALARM_SOUND_MAX_MS, silenced: false } : {}),
      };
      alarmsRef.current = sortAlarms(alarmsRef.current.map((a) => (a.id === existing.id ? updated : a)));
      setAlarms(alarmsRef.current);
      return existing.id;
    }

    const alarm: ActiveAlarm = {
      id: `alarm-${opts.sourceId}-${now}`,
      sourceId: opts.sourceId,
      severity: opts.severity,
      title: opts.title,
      message: opts.message,
      fenceName: opts.fenceName ?? null,
      startedAt: now,
      soundUntil: now + ALARM_SOUND_MAX_MS,
      silenced: false,
    };
    alarmsRef.current = sortAlarms([...alarmsRef.current, alarm]);
    setAlarms(alarmsRef.current);
    void postAlarmNotification(alarm);
    return alarm.id;
  }, []);

  const dismissAlarm = useCallback((sourceId: string) => {
    if (!alarmsRef.current.some((a) => a.sourceId === sourceId)) return;
    alarmsRef.current = alarmsRef.current.filter((a) => a.sourceId !== sourceId);
    setAlarms(alarmsRef.current);
    clearAlarmNotification(sourceId);
  }, []);

  const dismissAllAlarms = useCallback(() => {
    for (const a of alarmsRef.current) clearAlarmNotification(a.sourceId);
    alarmsRef.current = [];
    setAlarms([]);
  }, []);

  const value = useMemo<AlarmContextValue>(
    () => ({
      alarms,
      activeAlarm: alarms[0] ?? null,
      triggerAlarm,
      dismissAlarm,
      dismissAllAlarms,
    }),
    [alarms, triggerAlarm, dismissAlarm, dismissAllAlarms]
  );

  return <AlarmContext.Provider value={value}>{children}</AlarmContext.Provider>;
}

export function useAlarm() {
  const ctx = useContext(AlarmContext);
  if (!ctx) throw new Error('useAlarm must be used within AlarmProvider');
  return ctx;
}
