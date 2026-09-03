import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';

export type AlarmSeverity = 'warning' | 'breach';

export type ActiveAlarm = {
  id: string;
  severity: AlarmSeverity;
  title: string;
  message: string;
  fenceName: string | null;
  startedAt: number;
  /** Identifies who this alarm is for (a livestock id, or 'phone' for the on-map GPS probe) — lets a caller check "is my breach still the active alarm?" before dismissing someone else's. */
  sourceId: string | null;
};

const ALARM_MAX_DURATION_MS = 5 * 60 * 1000;

type AlarmContextValue = {
  activeAlarm: ActiveAlarm | null;
  triggerAlarm: (opts: {
    severity: AlarmSeverity;
    title: string;
    message: string;
    fenceName?: string | null;
    sourceId?: string | null;
  }) => Promise<string | undefined>;
  dismissAlarm: () => Promise<void>;
  notificationsReady: boolean;
};

const AlarmContext = createContext<AlarmContextValue | null>(null);

const BREACH_PATTERN = [0, 500, 200, 500, 200, 500, 200, 800] as const;
const WARNING_PATTERN = [0, 300, 150, 300] as const;

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

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    priority: Notifications.AndroidNotificationPriority.MAX,
  }),
});

export function AlarmProvider({ children }: { children: ReactNode }) {
  const [activeAlarm, setActiveAlarm] = useState<ActiveAlarm | null>(null);
  const [notificationsReady, setNotificationsReady] = useState(false);
  const vibrationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const notifTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundInstancesRef = useRef<Map<string, Audio.Sound>>(new Map());
  const audioReadyRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          staysActiveInBackground: true,
          interruptionModeIOS: InterruptionModeIOS.DoNotMix,
          interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });

        try {
          const { sound: ws } = await Audio.Sound.createAsync(
            { uri: WARNING_BEEP_WAV },
            { shouldPlay: false, volume: 1.0 }
          );
          soundInstancesRef.current.set('warning', ws);
          const { sound: bs } = await Audio.Sound.createAsync(
            { uri: BREACH_BEEP_WAV },
            { shouldPlay: false, volume: 1.0 }
          );
          soundInstancesRef.current.set('breach', bs);
          audioReadyRef.current = true;
        } catch (audioErr) {
          console.warn('[AlarmProvider] audio preload failed:', audioErr);
        }

        const existingPerms = await Notifications.getPermissionsAsync();
        const iosStatus = existingPerms.ios?.status;
        const androidStatus = (existingPerms as any).status;
        let granted =
          iosStatus === 2 || androidStatus === 'granted' || androidStatus === 3;
        if (!granted) {
          const perms = await Notifications.requestPermissionsAsync({
            ios: {
              allowAlert: true,
              allowBadge: true,
              allowSound: true,
              allowCriticalAlerts: true,
            },
          });
          const iosAfter = perms.ios?.status;
          const androidAfter = (perms as any).status;
          granted =
            iosAfter === 2 ||
            androidAfter === 'granted' ||
            androidAfter === 3;
        }
        setNotificationsReady(granted);
      } catch (err) {
        console.warn('[AlarmProvider] setup failed:', err);
        setNotificationsReady(true);
      }
    })();

    return () => {
      stopAllTimers();
      void stopAllSounds();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopAllSounds = useCallback(async () => {
    const map = soundInstancesRef.current;
    for (const [key, snd] of map.entries()) {
      try {
        await snd.stopAsync();
        await snd.setPositionAsync(0);
      } catch {
        void key;
      }
    }
  }, []);

  const playSingleBeep = useCallback(async (severity: AlarmSeverity) => {
    if (!audioReadyRef.current) return;
    const snd = soundInstancesRef.current.get(severity);
    if (!snd) return;
    try {
      await snd.replayAsync();
    } catch (err) {
      console.warn('[AlarmProvider] beep play failed:', err);
    }
  }, []);

  const playBeepBurst = useCallback(
    async (severity: AlarmSeverity) => {
      const count = severity === 'breach' ? 3 : 1;
      const gapMs = severity === 'breach' ? 110 : 0;
      for (let i = 0; i < count; i++) {
        void playSingleBeep(severity);
        if (i < count - 1) {
          await new Promise((r) => setTimeout(r, gapMs));
        }
      }
    },
    [playSingleBeep]
  );

  const stopAllTimers = useCallback(() => {
    if (vibrationTimerRef.current) {
      clearInterval(vibrationTimerRef.current);
      vibrationTimerRef.current = null;
    }
    if (notifTimerRef.current) {
      clearInterval(notifTimerRef.current);
      notifTimerRef.current = null;
    }
    if (audioTimerRef.current) {
      clearInterval(audioTimerRef.current);
      audioTimerRef.current = null;
    }
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
  }, []);

  const dismissAlarm = useCallback(async () => {
    stopAllTimers();
    try {
      await Notifications.dismissAllNotificationsAsync();
    } catch {}
    void stopAllSounds();
    setActiveAlarm(null);
  }, [stopAllTimers, stopAllSounds]);

  const playToneBurst = useCallback((severity: AlarmSeverity) => {
    const pattern = severity === 'breach' ? [...BREACH_PATTERN] : [...WARNING_PATTERN];
    Vibration.vibrate(pattern);
  }, []);

  const pushLocalNotification = useCallback(
    async (alarm: ActiveAlarm) => {
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: alarm.title,
            body: alarm.message,
            sound: true,
            priority: Notifications.AndroidNotificationPriority.MAX,
          },
          trigger: null,
        });
      } catch (err) {
        console.warn('[AlarmProvider] scheduleNotification failed:', err);
      }
    },
    []
  );

  const triggerAlarm = useCallback(
    async (opts: {
      severity: AlarmSeverity;
      title: string;
      message: string;
      fenceName?: string | null;
      sourceId?: string | null;
    }) => {
      const { severity, title, message, fenceName = null, sourceId = null } = opts;
      const id = `alarm-${severity}-${Date.now()}`;
      const alarm: ActiveAlarm = {
        id,
        severity,
        title,
        message,
        fenceName,
        startedAt: Date.now(),
        sourceId,
      };

      setActiveAlarm((prev) => {
        if (prev && prev.severity === 'breach' && severity === 'warning') {
          return prev;
        }
        return alarm;
      });

      stopAllTimers();

      playToneBurst(severity);
      void playBeepBurst(severity);

      const vibrateInterval = severity === 'breach' ? 2500 : 4000;
      const notifInterval = severity === 'breach' ? 10000 : 20000;
      const audioInterval = severity === 'breach' ? 2500 : 4000;

      vibrationTimerRef.current = setInterval(
        () => playToneBurst(severity),
        vibrateInterval
      );

      notifTimerRef.current = setInterval(
        () => pushLocalNotification(alarm),
        notifInterval
      );

      audioTimerRef.current = setInterval(
        () => playBeepBurst(severity),
        audioInterval
      );

      // Alerts continuously for at most 5 minutes even if the animal never
      // returns inside the boundary — dismissAlarm() stops it sooner on re-entry.
      maxDurationTimerRef.current = setTimeout(() => {
        void dismissAlarm();
      }, ALARM_MAX_DURATION_MS);

      await pushLocalNotification(alarm);

      return id;
    },
    [stopAllTimers, playToneBurst, playBeepBurst, pushLocalNotification, dismissAlarm]
  );

  const value: AlarmContextValue = {
    activeAlarm,
    triggerAlarm,
    dismissAlarm,
    notificationsReady,
  };

  return <AlarmContext.Provider value={value}>{children}</AlarmContext.Provider>;
}

export function useAlarm() {
  const ctx = useContext(AlarmContext);
  if (!ctx) throw new Error('useAlarm must be used within AlarmProvider');
  return ctx;
}
