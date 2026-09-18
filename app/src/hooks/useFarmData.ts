import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  DEMO_ALERTS,
  DEMO_COLLARS,
  DEMO_GEOFENCES,
  DEMO_LIVESTOCK,
  DEMO_LOCATIONS,
} from '@/data/mockData';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useAlarm } from '@/hooks/useAlarm';
import { useAuthStore } from '@/stores/authStore';
import { BreachRecord, stepBreachStateMachine } from '@/lib/breachStateMachine';
import type {
  Alert,
  AlertType,
  AnimalStatus,
  Collar,
  Geofence,
  Livestock,
  LivestockLocation,
  MapLatLng,
} from '@/types/database';
import {
  evaluateAgainstFences,
  FenceEval,
  geoJsonToLatLngs,
  latLngsToRing,
} from '@/lib/utils';

export function useFarmData() {
  const demoMode = useAuthStore((s) => s.demoMode);
  const profile = useAuthStore((s) => s.profile);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { triggerAlarm, dismissAlarm, activeAlarm } = useAlarm();
  const activeAlarmRef = useRef(activeAlarm);
  useEffect(() => {
    activeAlarmRef.current = activeAlarm;
  }, [activeAlarm]);
  const breachRecordsRef = useRef<Record<string, BreachRecord>>({});

  const [livestock, setLivestock] = useState<Livestock[]>(DEMO_LIVESTOCK);
  const [collars, setCollars] = useState<Collar[]>(DEMO_COLLARS);
  const [alerts, setAlerts] = useState<Alert[]>(DEMO_ALERTS);
  const [locations, setLocations] = useState<LivestockLocation[]>(DEMO_LOCATIONS);
  const [geofences, setGeofences] = useState<Geofence[]>(DEMO_GEOFENCES);
  const [loading, setLoading] = useState(true);
  const [liveAlert, setLiveAlert] = useState<Alert | null>(null);

  const sessionKeyRef = useRef<string | null>(null);

  const resetDemoState = useCallback(() => {
    setLivestock(DEMO_LIVESTOCK);
    setCollars(DEMO_COLLARS);
    setAlerts(DEMO_ALERTS);
    setLocations(DEMO_LOCATIONS);
    setGeofences(DEMO_GEOFENCES);
  }, []);

  const loadFromSupabase = useCallback(async () => {
    setLoading(true);
    const [liveRes, collarRes, alertRes, locRes, fenceRes] = await Promise.all([
      supabase.from('livestock').select('*, collar:collars(*)').order('tag_id'),
      supabase.from('collars').select('*').order('device_hardware_id'),
      supabase
        .from('alerts')
        .select('*, livestock:livestock_id(id, name, tag_id)')
        .order('created_at', { ascending: false }),
      supabase.from('latest_livestock_locations').select('*'),
      supabase.rpc('get_geofences_geojson'),
    ]);

    if (liveRes.data) setLivestock(liveRes.data as Livestock[]);
    if (collarRes.data) setCollars(collarRes.data as Collar[]);
    if (alertRes.data) setAlerts(alertRes.data as Alert[]);
    if (locRes.data) setLocations(locRes.data as LivestockLocation[]);
    if (fenceRes.data) setGeofences(fenceRes.data as Geofence[]);
    setLoading(false);
  }, []);

  const load = useCallback(async () => {
    if (!profile) {
      resetDemoState();
      setLoading(false);
      return;
    }

    if (demoMode || !isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    await loadFromSupabase();
  }, [profile, demoMode, resetDemoState, loadFromSupabase]);

  useEffect(() => {
    const sessionKey = profile?.id ?? null;
    if (sessionKey === sessionKeyRef.current) return;

    sessionKeyRef.current = sessionKey;

    if (!sessionKey) {
      resetDemoState();
      setLoading(false);
      return;
    }

    if (demoMode || !isSupabaseConfigured) {
      resetDemoState();
      setLoading(false);
      return;
    }

    void loadFromSupabase();
  }, [profile?.id, demoMode, resetDemoState, loadFromSupabase]);

  useEffect(() => {
    if (demoMode || !isSupabaseConfigured) return;

    const alertChannel = supabase
      .channel('alerts-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'alerts' },
        (payload) => {
          const incoming = payload.new as Alert;
          setAlerts((prev) => [incoming, ...prev]);
          setLiveAlert(incoming);
        }
      )
      .subscribe();

    const locChannel = supabase
      .channel('locations-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'location_logs' },
        () => {
          void load();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(alertChannel);
      supabase.removeChannel(locChannel);
    };
  }, [demoMode, load]);

  const unresolvedAlerts = useMemo(
    () => alerts.filter((a) => a.status === 'unresolved'),
    [alerts]
  );

  const activeFences = useMemo(
    () =>
      geofences
        .filter((g) => g.is_active)
        .map((g) => ({
          id: g.id,
          name: g.name,
          ring: geoJsonToLatLngs(g.coordinates.coordinates),
          warningBufferMeters: g.warning_buffer_meters ?? 30,
        })),
    [geofences]
  );

  const evaluatePointAgainstFences = useCallback(
    (pt: MapLatLng): FenceEval => evaluateAgainstFences(pt, activeFences),
    [activeFences]
  );

  /** Inserts a new alert at the top of the list and shows the live banner. */
  const pushAlert = useCallback((alert: Alert) => {
    setAlerts((prev) => {
      // Don't duplicate the same unresolved breach.
      if (
        alert.alert_type !== 'info' &&
        alert.alert_type !== 'low_battery' &&
        prev.some(
          (a) =>
            a.status === 'unresolved' &&
            a.alert_type === alert.alert_type &&
            a.geofence_id === alert.geofence_id &&
            a.livestock_id === alert.livestock_id
        )
      ) {
        return prev;
      }
      return [alert, ...prev];
    });
    setLiveAlert(alert);
  }, []);

  /**
   * Evaluates each saved livestock location against active fences, updates
   * status, pushes approach-warning alerts, and runs the boundary-breach
   * state machine (in_bounds -> breach_active -> resolved) — the one place
   * that decides when the app-wide siren fires and when a breach auto-resolves.
   */
  const resolveAlert = useCallback(
    async (id: string) => {
      if (demoMode || !isSupabaseConfigured) {
        setAlerts((prev) =>
          prev.map((a) =>
            a.id === id
              ? { ...a, status: 'resolved', resolved_at: new Date().toISOString() }
              : a
          )
        );
        return;
      }
      await supabase
        .from('alerts')
        .update({ status: 'resolved', resolved_at: new Date().toISOString() })
        .eq('id', id);
      await load();
    },
    [demoMode, load]
  );

  const evaluateAllLivestock = useCallback(() => {
    if (activeFences.length === 0) return;
    const updates: { id: string; status: AnimalStatus }[] = [];
    const locUpdates: { id: string; status: AnimalStatus }[] = [];
    const evaluations: { livestockId: string; evaluation: FenceEval }[] = [];

    for (const loc of locations) {
      if (loc.latitude == null || loc.longitude == null) continue;
      const ev = evaluateAgainstFences(
        { latitude: loc.latitude, longitude: loc.longitude },
        activeFences
      );
      evaluations.push({ livestockId: loc.livestock_id, evaluation: ev });

      const next: AnimalStatus =
        ev.state === 'breach'
          ? 'breach'
          : ev.state === 'warning'
            ? 'near_boundary'
            : 'grazing';
      if (next !== loc.animal_status) locUpdates.push({ id: loc.livestock_id, status: next });
      const stock = livestock.find((l) => l.id === loc.livestock_id);
      if (stock && stock.animal_status !== next) updates.push({ id: stock.id, status: next });

      if (ev.state === 'warning') {
        const alert: Alert = {
          id: `a-${loc.livestock_id}-warn-${Math.floor(Date.now() / 60000)}`,
          collar_id: loc.collar_id,
          livestock_id: loc.livestock_id,
          geofence_id: ev.fenceId,
          alert_type: 'approach_warning',
          status: 'unresolved',
          title: `${loc.name} is near the boundary`,
          description: `${loc.tag_id} is ~${Math.round(ev.distanceMeters)}m from the edge of ${ev.fenceName ?? 'the pasture'}`,
          created_at: new Date().toISOString(),
          resolved_at: null,
        };
        pushAlert(alert);
      }
    }

    if (locUpdates.length) {
      setLocations((prev) =>
        prev.map((l) => {
          const match = locUpdates.find((u) => u.id === l.livestock_id);
          return match ? { ...l, animal_status: match.status } : l;
        })
      );
    }
    if (updates.length) {
      setLivestock((prev) =>
        prev.map((l) => {
          const match = updates.find((u) => u.id === l.id);
          return match ? { ...l, animal_status: match.status } : l;
        })
      );
    }

    const transitions = stepBreachStateMachine(evaluations, breachRecordsRef.current);
    for (const t of transitions) {
      if (t.type === 'enter_breach') {
        const loc = locations.find((l) => l.livestock_id === t.livestockId);
        if (!loc) continue;
        const alertId = `a-${t.livestockId}-breach-${Date.now()}`;
        const alert: Alert = {
          id: alertId,
          collar_id: loc.collar_id,
          livestock_id: t.livestockId,
          geofence_id: t.fenceId,
          alert_type: 'boundary_breach',
          status: 'unresolved',
          title: `${loc.name} crossed the fence`,
          description: `${loc.tag_id} left ${t.fenceName ?? 'the pasture'} by ~${Math.round(t.distanceMeters)}m`,
          created_at: new Date().toISOString(),
          resolved_at: null,
        };
        pushAlert(alert);
        breachRecordsRef.current = {
          ...breachRecordsRef.current,
          [t.livestockId]: {
            fenceId: t.fenceId,
            fenceName: t.fenceName,
            startedAt: Date.now(),
            alertId,
          },
        };
        void triggerAlarm({
          severity: 'breach',
          title: `${loc.name} left ${t.fenceName ?? 'the pasture'}`,
          message: `${loc.tag_id} is outside the boundary. Locate the animal and check the fence.`,
          fenceName: t.fenceName,
          sourceId: t.livestockId,
        });
      } else {
        const { [t.livestockId]: _resolved, ...rest } = breachRecordsRef.current;
        breachRecordsRef.current = rest;
        void resolveAlert(t.record.alertId);
        if (activeAlarmRef.current?.sourceId === t.livestockId) {
          void dismissAlarm();
        }
      }
    }
  }, [activeFences, locations, livestock, pushAlert, triggerAlarm, dismissAlarm, resolveAlert]);

  useEffect(() => {
    // Re-run whenever fences, livestock, or locations change (on save / on streaming updates).
    if (activeFences.length === 0) return;
    evaluateAllLivestock();
  }, [activeFences.length, evaluateAllLivestock]);

  /**
   * Record a fence-crossing event for an arbitrary point (e.g. the user's own phone GPS)
   * and return the evaluator result so the UI can show distance / vibrate accordingly.
   */
  const recordFenceCrossing = useCallback(
    (pt: MapLatLng, opts?: { subjectId?: string; subjectName?: string; silent?: boolean }): FenceEval => {
      const ev = evaluateAgainstFences(pt, activeFences);
      if (opts?.silent) return ev;

      const id = opts?.subjectId ?? 'phone';
      const name = opts?.subjectName ?? 'Your device';
      const alertType: AlertType | null =
        ev.state === 'breach'
          ? 'boundary_breach'
          : ev.state === 'warning'
            ? 'approach_warning'
            : null;

      if (alertType) {
        const alert: Alert = {
          id: `a-${id}-${alertType}-${Math.floor(Date.now() / 30000)}`,
          collar_id: null,
          livestock_id: null,
          geofence_id: ev.fenceId,
          alert_type: alertType,
          status: 'unresolved',
          title: alertType === 'boundary_breach' ? `${name} left the pasture` : `${name} is near a fence`,
          description: ev.fenceName
            ? `${name} is ~${Math.round(ev.distanceMeters)}m from the edge of ${ev.fenceName}`
            : `${name} is ~${Math.round(ev.distanceMeters)}m from the nearest active fence`,
          created_at: new Date().toISOString(),
          resolved_at: null,
        };
        pushAlert(alert);
      }
      return ev;
    },
    [activeFences, pushAlert]
  );

  const alertCounts = useMemo(() => {
    const critical = unresolvedAlerts.filter(
      (a) => a.alert_type === 'boundary_breach'
    ).length;
    const warning = unresolvedAlerts.filter((a) =>
      ['approach_warning', 'low_battery', 'stationary'].includes(a.alert_type)
    ).length;
    const info = unresolvedAlerts.filter((a) => a.alert_type === 'info').length;
    return { critical, warning, info, total: unresolvedAlerts.length };
  }, [unresolvedAlerts]);

  const saveGeofence = async (name: string, points: MapLatLng[], id?: string) => {
    if (!isAdmin()) throw new Error('Only admins can manage fences');

    const ring = latLngsToRing(points);

    if (demoMode || !isSupabaseConfigured) {
      const fence: Geofence = {
        id: id ?? `g-${Date.now()}`,
        name,
        is_active: true,
        warning_buffer_meters: 30,
        created_by: 'demo-admin',
        coordinates: { type: 'Polygon', coordinates: [ring] },
      };
      setGeofences((prev) =>
        id ? prev.map((g) => (g.id === id ? fence : g)) : [...prev, fence]
      );
      return fence.id;
    }

    const { data, error } = await supabase.rpc('upsert_geofence', {
      p_id: id ?? null,
      p_name: name,
      p_ring: ring,
      p_is_active: true,
      p_warning_buffer_meters: 30,
    });
    if (error) throw error;
    await load();
    return data as string;
  };

  const deleteGeofence = async (id: string) => {
    if (!isAdmin()) throw new Error('Only admins can delete fences');
    if (demoMode || !isSupabaseConfigured) {
      setGeofences((prev) => prev.filter((g) => g.id !== id));
      return;
    }
    await supabase.from('geofences').delete().eq('id', id);
    await load();
  };

  const upsertLivestock = async (
    payload: Partial<Livestock> & { name: string; tag_id: string; breed: string }
  ) => {
    if (!isAdmin()) throw new Error('Only admins can manage livestock');

    if (demoMode || !isSupabaseConfigured) {
      if (payload.id) {
        setLivestock((prev) =>
          prev.map((l) => (l.id === payload.id ? { ...l, ...payload } : l))
        );
      } else {
        const created: Livestock = {
          id: `l-${Date.now()}`,
          tag_id: payload.tag_id,
          name: payload.name,
          breed: payload.breed,
          age: payload.age ?? null,
          health_status: payload.health_status ?? 'healthy',
          animal_status: 'grazing',
          collar_id: payload.collar_id ?? null,
          training_success_rate: 0,
          audio_warning_count: 0,
          vibration_pulse_count: 0,
          collar: collars.find((c) => c.id === payload.collar_id) ?? null,
        };
        setLivestock((prev) => [...prev, created]);
      }
      return;
    }

    if (payload.id) {
      await supabase.from('livestock').update(payload).eq('id', payload.id);
    } else {
      await supabase.from('livestock').insert(payload);
    }
    await load();
  };

  const deleteLivestock = async (id: string) => {
    if (!isAdmin()) throw new Error('Only admins can delete livestock');
    if (demoMode || !isSupabaseConfigured) {
      setLivestock((prev) => prev.filter((l) => l.id !== id));
      return;
    }
    await supabase.from('livestock').delete().eq('id', id);
    await load();
  };

  const dismissLiveAlert = () => setLiveAlert(null);

  return {
    livestock,
    collars,
    alerts,
    unresolvedAlerts,
    alertCounts,
    locations,
    geofences,
    loading,
    liveAlert,
    dismissLiveAlert,
    refresh: load,
    evaluatePointAgainstFences,
    recordFenceCrossing,
    saveGeofence,
    deleteGeofence,
    upsertLivestock,
    deleteLivestock,
    resolveAlert,
    isAdmin: profile?.role === 'admin',
  };
}
