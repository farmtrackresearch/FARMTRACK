import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  DEMO_ALERTS,
  DEMO_COLLARS,
  DEMO_FARM_SETTINGS,
  DEMO_GEOFENCES,
  DEMO_LIVESTOCK,
  DEMO_LOCATIONS,
} from '@/data/mockData';
import { useAlarm } from '@/hooks/useAlarm';
import { BreachRecord, stepBreachStateMachine } from '@/lib/breachStateMachine';
import { applyLocationReadings, LocationReading, queueLocationReading, reconcileLocations } from '@/lib/liveLocations';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { latLngsToRing, timeAgo } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import type {
  Alert,
  Collar,
  FarmSettings,
  Geofence,
  HealthStatus,
  Livestock,
  LivestockLocation,
  MapLatLng,
} from '@/types/database';

/**
 * - `offline`: demo mode or signed out — nothing to connect to.
 * - `connecting`: first subscribe in progress.
 * - `live`: every core realtime channel is subscribed.
 * - `reconnecting`: a core channel dropped; realtime-js is retrying.
 */
export type RealtimeHealth = 'offline' | 'connecting' | 'live' | 'reconnecting';

export type SaveGeofenceInput = {
  id?: string;
  name: string;
  points: MapLatLng[];
  isActive: boolean;
  warningBufferMeters: number;
};

export type LivestockInput = {
  id?: string;
  name: string;
  tag_id: string;
  breed: string;
  age: number | null;
  health_status: HealthStatus;
  collar_id: string | null;
};

const ALERT_SELECT = '*, livestock:livestock_id(id, name, tag_id)';
/** Alert history kept in memory on top of every unresolved alert. */
const ALERT_HISTORY_LIMIT = 100;
/** Safety cap only; the server auto-resolves fence alerts, so this is never reached in practice. */
const UNRESOLVED_ALERT_LIMIT = 500;
/**
 * Realtime work is coalesced in fixed windows: the first event schedules the
 * work, later events in the window ride along. (A trailing debounce would
 * never fire once several collars report more often than the window.)
 */
const LOCATION_RELOAD_WINDOW_MS = 1500;
/** Batch GPS bursts briefly without querying the full farm for every fix. */
const LOCATION_APPLY_WINDOW_MS = 100;
const COLLAR_APPLY_WINDOW_MS = 1000;
const GEOFENCE_RELOAD_WINDOW_MS = 500;
const RELOAD_ALL_WINDOW_MS = 1000;
const LIVESTOCK_RECONCILE_WINDOW_MS = 1000;
/** Re-render this often so "x min ago" labels and stale markers stay current. */
const TICK_MS = 30_000;
/** Channels that must be up for the app to call itself live. */
const CORE_TABLES = new Set(['alerts', 'location_logs', 'livestock', 'collars']);

function byNewest(a: Alert, b: Alert) {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

function mergeAlerts(...lists: Alert[][]): Alert[] {
  const byId = new Map<string, Alert>();
  for (const list of lists) for (const a of list) byId.set(a.id, a);
  return [...byId.values()].sort(byNewest);
}

export const SESSION_EXPIRED_MESSAGE = 'Session expired – reconnecting';

/**
 * After a failed token refresh supabase-js quietly queries as `anon`, and RLS
 * then returns [] with no error. Loaders check this first so an expired
 * session is reported as a load error instead of wiping the farm (and, via
 * the breach tracker, silencing the siren for an animal still outside).
 */
async function hasSession(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

/**
 * True when `next` must not replace the current list: it is empty, the list
 * is not, and the session has gone (the query raced the expiry).
 */
async function emptyBecauseSessionLost(next: unknown[], currentLength: number): Promise<boolean> {
  return next.length === 0 && currentLength > 0 && !(await hasSession());
}

function requireAdmin(what: string) {
  if (!useAuthStore.getState().isAdmin()) throw new Error(`Only admins can ${what}.`);
}

/**
 * `lastSeenAt`: undefined = this animal's position has not loaded yet, so say
 * nothing about fix age; null = loaded, but the collar has never had a fix.
 */
function breachAlarmText(animal: Pick<Livestock, 'name' | 'tag_id'>, lastSeenAt: string | null | undefined) {
  const fixAge =
    lastSeenAt === undefined
      ? ''
      : lastSeenAt === null
        ? ' · no GPS fix yet'
        : ` · last fix ${timeAgo(lastSeenAt).toLowerCase()}`;
  return {
    title: `${animal.name} is outside the fence`,
    message: `Tag ${animal.tag_id}${fixAge}. Go and check the animal and the fence.`,
  };
}

export function useFarmData() {
  const demoMode = useAuthStore((s) => s.demoMode);
  const profileId = useAuthStore((s) => s.profile?.id ?? null);
  const role = useAuthStore((s) => s.profile?.role ?? null);
  const isAdmin = role === 'admin';
  const connected = Boolean(profileId) && !demoMode && isSupabaseConfigured;
  const { triggerAlarm, dismissAlarm, dismissAllAlarms } = useAlarm();

  const [livestock, setLivestock] = useState<Livestock[]>(DEMO_LIVESTOCK);
  const [collars, setCollars] = useState<Collar[]>(DEMO_COLLARS);
  const [alerts, setAlerts] = useState<Alert[]>(DEMO_ALERTS);
  const [locations, setLocations] = useState<LivestockLocation[]>(DEMO_LOCATIONS);
  const [geofences, setGeofences] = useState<Geofence[]>(DEMO_GEOFENCES);
  const [farmSettings, setFarmSettings] = useState<FarmSettings | null>(DEMO_FARM_SETTINGS);
  const [loading, setLoading] = useState(connected);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [liveAlert, setLiveAlert] = useState<Alert | null>(null);
  const [realtimeHealth, setRealtimeHealth] = useState<RealtimeHealth>(connected ? 'connecting' : 'offline');
  const [now, setNow] = useState(() => Date.now());

  // Session change (sign-in, sign-out, user switch): reset every piece of
  // farm state during render, React's pattern for state that follows a prop,
  // so no screen ever shows the previous user's farm for a frame. External
  // side effects (alarms, loading) happen in the effect further down.
  const sessionKey = `${profileId ?? ''}|${demoMode}`;
  const [renderedSessionKey, setRenderedSessionKey] = useState(sessionKey);
  if (renderedSessionKey !== sessionKey) {
    setRenderedSessionKey(sessionKey);
    setLivestock(DEMO_LIVESTOCK);
    setCollars(DEMO_COLLARS);
    setAlerts(DEMO_ALERTS);
    setLocations(DEMO_LOCATIONS);
    setGeofences(DEMO_GEOFENCES);
    setFarmSettings(DEMO_FARM_SETTINGS);
    setLiveAlert(null);
    setLoadError(null);
    setLastLoadedAt(null);
    setLoading(connected);
    setRealtimeHealth(connected ? 'connecting' : 'offline');
  }

  /** Bumped on every sign-in/out so answers to an old session's queries are dropped. */
  const sessionGenRef = useRef(0);
  const breachRecordsRef = useRef<Record<string, BreachRecord>>({});
  const livestockRef = useRef<Livestock[]>(livestock);
  const collarsRef = useRef<Collar[]>(collars);
  const locationsRef = useRef<LivestockLocation[]>(locations);
  const alertsRef = useRef<Alert[]>(alerts);
  const geofencesRef = useRef<Geofence[]>(geofences);

  useEffect(() => {
    livestockRef.current = livestock;
    collarsRef.current = collars;
    locationsRef.current = locations;
    alertsRef.current = alerts;
    geofencesRef.current = geofences;
  }, [livestock, collars, locations, alerts, geofences]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // ---------------------------------------------------------------------------
  // Loaders. Each returns an error message, or null on success.
  // ---------------------------------------------------------------------------

  const loadLivestock = useCallback(async (): Promise<string | null> => {
    const gen = sessionGenRef.current;
    if (!(await hasSession())) return SESSION_EXPIRED_MESSAGE;
    const { data, error } = await supabase.from('livestock').select('*, collar:collars(*)').order('tag_id');
    if (gen !== sessionGenRef.current) return null;
    if (error) return `Livestock: ${error.message}`;
    const next = (data ?? []) as Livestock[];
    if (await emptyBecauseSessionLost(next, livestockRef.current.length)) return SESSION_EXPIRED_MESSAGE;
    setLivestock(next);
    return null;
  }, []);

  const loadCollars = useCallback(async (): Promise<string | null> => {
    const gen = sessionGenRef.current;
    if (!(await hasSession())) return SESSION_EXPIRED_MESSAGE;
    const { data, error } = await supabase.from('collars').select('*').order('device_hardware_id');
    if (gen !== sessionGenRef.current) return null;
    if (error) return `Collars: ${error.message}`;
    const next = (data ?? []) as Collar[];
    if (await emptyBecauseSessionLost(next, collarsRef.current.length)) return SESSION_EXPIRED_MESSAGE;
    setCollars(next);
    return null;
  }, []);

  const loadAlerts = useCallback(async (): Promise<string | null> => {
    const gen = sessionGenRef.current;
    if (!(await hasSession())) return SESSION_EXPIRED_MESSAGE;
    const [unresolved, recent] = await Promise.all([
      supabase
        .from('alerts')
        .select(ALERT_SELECT)
        .eq('status', 'unresolved')
        .order('created_at', { ascending: false })
        .limit(UNRESOLVED_ALERT_LIMIT),
      supabase
        .from('alerts')
        .select(ALERT_SELECT)
        .order('created_at', { ascending: false })
        .limit(ALERT_HISTORY_LIMIT),
    ]);
    if (gen !== sessionGenRef.current) return null;
    const error = unresolved.error ?? recent.error;
    if (error) return `Alerts: ${error.message}`;
    const next = mergeAlerts((recent.data ?? []) as Alert[], (unresolved.data ?? []) as Alert[]);
    if (await emptyBecauseSessionLost(next, alertsRef.current.length)) return SESSION_EXPIRED_MESSAGE;
    setAlerts(next);
    return null;
  }, []);

  const loadLocations = useCallback(async (): Promise<string | null> => {
    const gen = sessionGenRef.current;
    if (!(await hasSession())) return SESSION_EXPIRED_MESSAGE;
    const { data, error } = await supabase.from('latest_livestock_locations').select('*');
    if (gen !== sessionGenRef.current) return null;
    if (error) return `Positions: ${error.message}`;
    const next = (data ?? []) as LivestockLocation[];
    if (await emptyBecauseSessionLost(next, locationsRef.current.length)) return SESSION_EXPIRED_MESSAGE;
    setLocations((current) => reconcileLocations(current, next));
    return null;
  }, []);

  const loadGeofences = useCallback(async (): Promise<string | null> => {
    const gen = sessionGenRef.current;
    if (!(await hasSession())) return SESSION_EXPIRED_MESSAGE;
    const { data, error } = await supabase.rpc('get_geofences_geojson');
    if (gen !== sessionGenRef.current) return null;
    if (error) return `Fences: ${error.message}`;
    const next = (data ?? []) as Geofence[];
    if (await emptyBecauseSessionLost(next, geofencesRef.current.length)) return SESSION_EXPIRED_MESSAGE;
    setGeofences(next);
    return null;
  }, []);

  const loadFarmSettings = useCallback(async (): Promise<string | null> => {
    const gen = sessionGenRef.current;
    if (!(await hasSession())) return SESSION_EXPIRED_MESSAGE;
    const { data, error } = await supabase.from('farm_settings').select('*').eq('id', 1).maybeSingle();
    if (gen !== sessionGenRef.current) return null;
    if (error) {
      // Not fatal: a database that predates Emergency Disable has no such table.
      console.warn('[useFarmData] farm_settings unavailable:', error.message);
      setFarmSettings(null);
      return null;
    }
    setFarmSettings((data as FarmSettings | null) ?? null);
    return null;
  }, []);

  const loadAll = useCallback(
    async () => {
      const gen = sessionGenRef.current;
      const results = await Promise.all([
        loadLivestock(),
        loadCollars(),
        loadAlerts(),
        loadLocations(),
        loadGeofences(),
        loadFarmSettings(),
      ]);
      if (gen !== sessionGenRef.current) return;
      const errors = [...new Set(results.filter((r): r is string => r !== null))];
      // Keep showing the last good data; just say it could not be refreshed.
      setLoadError(errors.length ? errors.join('\n') : null);
      if (errors.length === 0) setLastLoadedAt(Date.now());
      setLoading(false);
    },
    [loadLivestock, loadCollars, loadAlerts, loadLocations, loadGeofences, loadFarmSettings]
  );

  // Realtime handlers call the latest loaders (and the alarm) through this ref,
  // so the subscription effect depends only on the session: profile id + demo
  // mode. It used to depend on a loader that changed on every hourly token
  // refresh, which tore the channels down and re-created them dead.
  const loadersRef = useRef({ loadAll, loadLivestock, loadLocations, loadGeofences, triggerAlarm });
  useEffect(() => {
    loadersRef.current = { loadAll, loadLivestock, loadLocations, loadGeofences, triggerAlarm };
  }, [loadAll, loadLivestock, loadLocations, loadGeofences, triggerAlarm]);

  // ---------------------------------------------------------------------------
  // Session: on every sign-in / sign-out, drop the old session's alarms and
  // in-flight answers, then load. (State was already reset during render.)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    sessionGenRef.current += 1;
    breachRecordsRef.current = {};
    dismissAllAlarms();
    if (!profileId || demoMode || !isSupabaseConfigured) return;
    void loadersRef.current.loadAll();
  }, [profileId, demoMode, dismissAllAlarms]);

  // ---------------------------------------------------------------------------
  // Realtime + foreground refresh.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!profileId || demoMode || !isSupabaseConfigured) return;

    // realtime-js returns the EXISTING channel when a topic is reused, so a
    // re-subscribe with a fixed name silently attaches to a dead channel.
    const suffix = `${profileId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const statuses = new Map<string, string>();
    const everSubscribed = new Set<string>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    let disposed = false;

    const schedule = (key: string, ms: number, fn: () => void) => {
      if (timers.has(key)) return;
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          if (!disposed) fn();
        }, ms)
      );
    };
    const reloadAll = () => schedule('reload-all', RELOAD_ALL_WINDOW_MS, () => void loadersRef.current.loadAll());
    const reloadLocations = () =>
      schedule('locations', LOCATION_RELOAD_WINDOW_MS, () => void loadersRef.current.loadLocations());
    const reloadLivestock = () =>
      schedule('livestock', LIVESTOCK_RECONCILE_WINDOW_MS, () => void loadersRef.current.loadLivestock());

    const pendingLocations = new Map<string, LocationReading>();
    const flushLocations = () => {
      const readings = new Map(pendingLocations);
      pendingLocations.clear();
      if (readings.size > 0) setLocations((current) => applyLocationReadings(current, readings));
    };

    // Every collar ping updates last_ping_at; apply them in batches so a herd
    // of collars does not re-render the app several times a second.
    const pendingCollars = new Map<string, Collar>();
    const flushCollars = () => {
      const updates = new Map(pendingCollars);
      pendingCollars.clear();
      if (updates.size === 0) return;
      setCollars((prev) => prev.map((c) => (updates.has(c.id) ? { ...c, ...updates.get(c.id) } : c)));
      setLivestock((prev) =>
        prev.map((l) => {
          const next = l.collar_id ? updates.get(l.collar_id) : undefined;
          return next ? { ...l, collar: { ...l.collar, ...next } } : l;
        })
      );
      setLocations((prev) =>
        prev.map((loc) => {
          const next = loc.collar_id ? updates.get(loc.collar_id) : undefined;
          return next
            ? { ...loc, battery_level: next.battery_level, collar_status: next.status, last_ping_at: next.last_ping_at }
            : loc;
        })
      );
    };

    const updateHealth = () => {
      const core = [...CORE_TABLES].map((t) => statuses.get(t));
      if (core.every((s) => s === 'SUBSCRIBED')) setRealtimeHealth('live');
      else if (core.some((s) => s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED')) {
        setRealtimeHealth('reconnecting');
      } else setRealtimeHealth('connecting');
    };

    const subscribe = <T extends Record<string, unknown>>(
      table: string,
      onChange: (payload: RealtimePostgresChangesPayload<T>) => void
    ): RealtimeChannel =>
      supabase
        .channel(`farmtrack-${table}-${suffix}`)
        .on<T>('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
          // Events can still arrive after cleanup began; never touch state then.
          if (disposed) return;
          onChange(payload);
        })
        .subscribe((status, err) => {
          if (disposed) return;
          statuses.set(table, status);
          if (status === 'SUBSCRIBED') {
            // A second SUBSCRIBED means realtime-js rejoined after a drop:
            // anything that happened meanwhile was missed, so re-read it all.
            if (everSubscribed.has(table)) reloadAll();
            everSubscribed.add(table);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`[realtime] ${table}: ${status}`, err?.message ?? '');
          }
          updateHealth();
        });

    const channels = [
      subscribe<Alert & Record<string, unknown>>('alerts', (payload) => {
        if (payload.eventType === 'INSERT') {
          const stock = livestockRef.current.find((l) => l.id === payload.new.livestock_id);
          const incoming: Alert = {
            ...payload.new,
            livestock: stock ? { id: stock.id, name: stock.name, tag_id: stock.tag_id } : null,
          };
          setAlerts((prev) => (prev.some((a) => a.id === incoming.id) ? prev : [incoming, ...prev]));
          if (incoming.alert_type !== 'info') setLiveAlert(incoming);

          const livestockId = incoming.livestock_id;
          if (incoming.alert_type === 'boundary_breach' && incoming.status === 'unresolved' && livestockId) {
            // The trigger sets animal_status and inserts this alert in one
            // transaction; mirror the status now so a late livestock event
            // cannot make the breach tracker think the animal is back inside.
            // (Only for animals already loaded: a record for an animal missing
            // from the list would be treated as deleted and resolved at once.)
            if (stock) {
              setLivestock((prev) =>
                prev.map((l) => (l.id === livestockId ? { ...l, animal_status: 'breach' } : l))
              );
              // The optimistic status can be stale (e.g. an event replayed
              // after a reconnect reload); re-read livestock to reconcile.
              reloadLivestock();
              breachRecordsRef.current = {
                ...breachRecordsRef.current,
                [livestockId]: breachRecordsRef.current[livestockId] ?? {
                  startedAt: Date.now(),
                  alertId: incoming.id,
                },
              };
            }
            loadersRef.current.triggerAlarm({
              sourceId: livestockId,
              severity: 'breach',
              title: stock ? `${stock.name} is outside the fence` : incoming.title,
              message: incoming.description ?? 'An animal crossed the fence. Go and check it.',
            });
          }
        } else if (payload.eventType === 'UPDATE') {
          const updated = payload.new;
          setAlerts((prev) =>
            prev.map((a) => (a.id === updated.id ? { ...updated, livestock: a.livestock } : a))
          );
          if (updated.status === 'resolved') {
            setLiveAlert((prev) => (prev?.id === updated.id ? null : prev));
          }
        }
      }),

      subscribe<LocationReading & Record<string, unknown>>('location_logs', (payload) => {
        if (payload.eventType !== 'INSERT') return;
        queueLocationReading(pendingLocations, payload.new);
        schedule('positions', LOCATION_APPLY_WINDOW_MS, flushLocations);
        // Initial-load races and animals added on another phone need their joined metadata.
        if (!locationsRef.current.some((location) => location.collar_id === payload.new.collar_id)) {
          reloadLocations();
        }
      }),

      subscribe<Livestock & Record<string, unknown>>('livestock', (payload) => {
        if (payload.eventType !== 'UPDATE') return;
        const next = payload.new;
        setLivestock((prev) =>
          prev.map((l) =>
            l.id === next.id
              ? {
                  ...l,
                  ...next,
                  collar:
                    next.collar_id === l.collar_id
                      ? l.collar
                      : (collarsRef.current.find((c) => c.id === next.collar_id) ?? null),
                }
              : l
          )
        );
        setLocations((prev) =>
          prev.map((loc) =>
            loc.livestock_id === next.id
              ? {
                  ...loc,
                  animal_status: next.animal_status,
                  health_status: next.health_status,
                  name: next.name,
                  tag_id: next.tag_id,
                  breed: next.breed,
                }
              : loc
          )
        );
        const prevCollar = livestockRef.current.find((l) => l.id === next.id)?.collar_id ?? null;
        if (prevCollar !== next.collar_id) reloadLocations();
      }),

      subscribe<Collar & Record<string, unknown>>('collars', (payload) => {
        if (payload.eventType === 'INSERT') {
          // Unknown collars are auto-registered by the gateway ingest; show
          // them at once so they can be paired from the Hardware tab.
          const created = payload.new;
          setCollars((prev) => (prev.some((c) => c.id === created.id) ? prev : [...prev, created]));
          return;
        }
        if (payload.eventType !== 'UPDATE') return;
        pendingCollars.set(payload.new.id, payload.new);
        schedule('collars', COLLAR_APPLY_WINDOW_MS, flushCollars);
      }),

      // Realtime delivers PostGIS geometry as EWKB hex, not GeoJSON, so any
      // fence change is re-read through the RPC instead of applied directly.
      subscribe<Record<string, unknown>>('geofences', () => {
        schedule('geofences', GEOFENCE_RELOAD_WINDOW_MS, () => void loadersRef.current.loadGeofences());
      }),

      subscribe<FarmSettings & Record<string, unknown>>('farm_settings', (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') setFarmSettings(payload.new);
      }),
    ];

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setNow(Date.now());
        reloadAll();
      }
    });

    return () => {
      disposed = true;
      appStateSub.remove();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const channel of channels) void supabase.removeChannel(channel);
    };
  }, [profileId, demoMode]);

  // ---------------------------------------------------------------------------
  // Siren: driven by the server's animal_status, never by a client-side check.
  // Fires at load time for animals already in breach and whenever one enters
  // breach; stops when the server says the animal has left breach.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const transitions = stepBreachStateMachine(
      livestock.map((l) => ({ livestockId: l.id, status: l.animal_status })),
      breachRecordsRef.current
    );
    if (transitions.length === 0) return;
    const records = { ...breachRecordsRef.current };
    for (const t of transitions) {
      if (t.type === 'enter_breach') {
        records[t.livestockId] = { startedAt: Date.now(), alertId: null };
        const animal = livestock.find((l) => l.id === t.livestockId);
        if (!animal) continue;
        const loc = locationsRef.current.find((l) => l.livestock_id === t.livestockId);
        triggerAlarm({
          sourceId: t.livestockId,
          severity: 'breach',
          ...breachAlarmText(animal, loc ? loc.last_seen_at : undefined),
        });
      } else {
        delete records[t.livestockId];
        dismissAlarm(t.livestockId);
      }
    }
    breachRecordsRef.current = records;
  }, [livestock, triggerAlarm, dismissAlarm]);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const unresolvedAlerts = useMemo(() => alerts.filter((a) => a.status === 'unresolved'), [alerts]);

  const alertCounts = useMemo(() => {
    const critical = unresolvedAlerts.filter((a) => a.alert_type === 'boundary_breach').length;
    const warning = unresolvedAlerts.filter((a) =>
      ['approach_warning', 'low_battery', 'stationary'].includes(a.alert_type)
    ).length;
    const info = unresolvedAlerts.filter((a) => a.alert_type === 'info').length;
    return { critical, warning, info, total: unresolvedAlerts.length };
  }, [unresolvedAlerts]);

  const collarsMutedUntil = useMemo(() => {
    const until = farmSettings?.collars_muted_until;
    if (!until) return null;
    return new Date(until).getTime() > now ? until : null;
  }, [farmSettings, now]);

  // ---------------------------------------------------------------------------
  // Writes. Every Supabase call checks {error} and throws, so screens can show
  // the reason and stay open instead of pretending it worked.
  // ---------------------------------------------------------------------------

  const saveGeofence = useCallback(
    async ({ id, name, points, isActive, warningBufferMeters }: SaveGeofenceInput): Promise<string> => {
      requireAdmin('manage fences');
      const ring = latLngsToRing(points);

      if (!connected) {
        const fence: Geofence = {
          id: id ?? `g-${Date.now()}`,
          name,
          is_active: isActive,
          warning_buffer_meters: warningBufferMeters,
          created_by: 'demo-admin',
          coordinates: { type: 'Polygon', coordinates: [ring] },
        };
        setGeofences((prev) => (id ? prev.map((g) => (g.id === id ? fence : g)) : [...prev, fence]));
        return fence.id;
      }

      const { data, error } = await supabase.rpc('upsert_geofence', {
        p_id: id ?? null,
        p_name: name,
        p_ring: ring,
        p_is_active: isActive,
        p_warning_buffer_meters: warningBufferMeters,
      });
      if (error) throw new Error(error.message);
      await loadGeofences();
      return data as string;
    },
    [connected, loadGeofences]
  );

  const deleteGeofence = useCallback(
    async (id: string) => {
      requireAdmin('delete fences');
      if (!connected) {
        setGeofences((prev) => prev.filter((g) => g.id !== id));
        return;
      }
      const { error } = await supabase.from('geofences').delete().eq('id', id);
      if (error) throw new Error(error.message);
      await loadGeofences();
    },
    [connected, loadGeofences]
  );

  const upsertLivestock = useCallback(
    async (input: LivestockInput) => {
      requireAdmin('manage livestock');
      const { id, ...fields } = input;

      if (!connected) {
        if (id) {
          setLivestock((prev) =>
            prev.map((l) =>
              l.id === id ? { ...l, ...fields, collar: collars.find((c) => c.id === fields.collar_id) ?? null } : l
            )
          );
        } else {
          const created: Livestock = {
            id: `l-${Date.now()}`,
            ...fields,
            animal_status: 'grazing',
            training_success_rate: null,
            audio_warning_count: 0,
            vibration_pulse_count: 0,
            collar: collars.find((c) => c.id === fields.collar_id) ?? null,
          };
          setLivestock((prev) => [...prev, created]);
        }
        return;
      }

      const { error } = id
        ? await supabase.from('livestock').update(fields).eq('id', id)
        : await supabase.from('livestock').insert(fields);
      if (error) {
        if (error.code === '23505') {
          throw new Error('That tag ID or collar is already used by another animal.');
        }
        throw new Error(error.message);
      }
      await Promise.all([loadLivestock(), loadLocations()]);
    },
    [connected, collars, loadLivestock, loadLocations]
  );

  const deleteLivestock = useCallback(
    async (id: string) => {
      requireAdmin('delete livestock');
      if (!connected) {
        setLivestock((prev) => prev.filter((l) => l.id !== id));
        return;
      }
      const { error } = await supabase.from('livestock').delete().eq('id', id);
      if (error) throw new Error(error.message);
      await Promise.all([loadLivestock(), loadLocations()]);
    },
    [connected, loadLivestock, loadLocations]
  );

  const resolveAlert = useCallback(
    async (id: string) => {
      const resolvedAt = new Date().toISOString();
      const markResolved = () =>
        setAlerts((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: 'resolved', resolved_at: resolvedAt } : a))
        );
      if (!connected) {
        markResolved();
        return;
      }
      // resolved_by is filled in by the database from auth.uid().
      const { error } = await supabase
        .from('alerts')
        .update({ status: 'resolved', resolved_at: resolvedAt })
        .eq('id', id);
      if (error) throw new Error(error.message);
      markResolved();
      setLiveAlert((prev) => (prev?.id === id ? null : prev));
    },
    [connected]
  );

  /**
   * Emergency Disable: silences every collar's buzzer for `minutes` (the
   * gateway relays SAFE while muted). 0 unmutes. Fence alerts in the app keep
   * working. Returns the new mute end time, or null when unmuted.
   */
  const setCollarsMuted = useCallback(
    async (minutes: number): Promise<string | null> => {
      const until = minutes > 0 ? new Date(Date.now() + minutes * 60_000).toISOString() : null;
      if (!connected) {
        setFarmSettings((prev) => ({
          ...(prev ?? DEMO_FARM_SETTINGS),
          collars_muted_until: until,
          updated_at: new Date().toISOString(),
        }));
        return until;
      }
      const { data, error } = await supabase.rpc('set_collars_muted', { p_minutes: minutes });
      if (error) throw new Error(error.message);
      const serverUntil = (data as string | null) ?? null;
      setFarmSettings((prev) => ({
        ...(prev ?? DEMO_FARM_SETTINGS),
        collars_muted_until: serverUntil,
        updated_at: new Date().toISOString(),
      }));
      return serverUntil;
    },
    [connected]
  );

  const refresh = useCallback(async () => {
    if (connected) await loadAll();
  }, [connected, loadAll]);

  const dismissLiveAlert = useCallback(() => setLiveAlert(null), []);

  return useMemo(
    () => ({
      livestock,
      collars,
      alerts,
      unresolvedAlerts,
      alertCounts,
      locations,
      geofences,
      farmSettings,
      collarsMutedUntil,
      loading,
      loadError,
      lastLoadedAt,
      realtimeHealth,
      now,
      liveAlert,
      dismissLiveAlert,
      refresh,
      saveGeofence,
      deleteGeofence,
      upsertLivestock,
      deleteLivestock,
      resolveAlert,
      setCollarsMuted,
      isAdmin,
      demoMode,
    }),
    [
      livestock,
      collars,
      alerts,
      unresolvedAlerts,
      alertCounts,
      locations,
      geofences,
      farmSettings,
      collarsMutedUntil,
      loading,
      loadError,
      lastLoadedAt,
      realtimeHealth,
      now,
      liveAlert,
      dismissLiveAlert,
      refresh,
      saveGeofence,
      deleteGeofence,
      upsertLivestock,
      deleteLivestock,
      resolveAlert,
      setCollarsMuted,
      isAdmin,
      demoMode,
    ]
  );
}
