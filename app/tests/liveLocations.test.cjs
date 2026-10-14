const assert = require('node:assert/strict');
const { test } = require('node:test');
const { applyLocationReadings, queueLocationReading, reconcileLocations } = require('../src/lib/liveLocations.ts');

const time = (seconds) => new Date(Date.UTC(2026, 9, 13, 0, 0, seconds)).toISOString();
const location = (overrides = {}) => ({
  livestock_id: 'animal-a', tag_id: 'A', name: 'Animal A', breed: 'Test',
  animal_status: 'breach', health_status: 'monitoring', collar_id: 'collar-a',
  device_hardware_id: 'FT-AAAAAAAA', battery_level: null, collar_status: 'active',
  connection_type: 'LoRa', latitude: 10, longitude: 120, last_seen_at: time(0),
  last_ping_at: time(0), sats: 8, ...overrides,
});
const reading = (overrides = {}) => ({
  collar_id: 'collar-a', latitude: 10.00001, longitude: 120.00001,
  timestamp: time(3), sats: 9, ...overrides,
});
const apply = (locations, ...readings) => {
  const pending = new Map();
  readings.forEach((item) => queueLocationReading(pending, item));
  return applyLocationReadings(locations, pending);
};

test('each small movement updates coordinates without waiting for a stop or distance threshold', () => {
  let positions = [location()];
  for (let step = 1; step <= 5; step++) {
    const fix = reading({ latitude: 10 + step * 0.000005, timestamp: time(step * 3) });
    positions = apply(positions, fix);
    assert.equal(positions[0].latitude, fix.latitude);
    assert.equal(positions[0].longitude, fix.longitude);
    assert.equal(positions[0].last_seen_at, fix.timestamp);
  }
});

test('GPS updates preserve fence status, health, pairing and heartbeat', () => {
  const before = location();
  const after = apply([before], reading())[0];
  assert.deepEqual(after, {
    ...before, latitude: 10.00001, longitude: 120.00001, last_seen_at: time(3), sats: 9,
  });
});

test('a first fix replaces empty coordinates', () => {
  const result = apply([location({ latitude: null, longitude: null, last_seen_at: null, sats: null })], reading());
  assert.equal(result[0].latitude, 10.00001);
  assert.equal(result[0].sats, 9);
});

test('a stationary new fix still advances the GPS timestamp', () => {
  const result = apply([location()], reading({ latitude: 10, longitude: 120 }));
  assert.equal(result[0].last_seen_at, time(3));
});

test('delayed and duplicate fixes do not move a marker backward or cause redundant updates', () => {
  const positions = [location({ last_seen_at: time(9) })];
  assert.equal(apply(positions, reading({ timestamp: time(6) })), positions);
  assert.equal(apply(positions, reading({ timestamp: time(9) })), positions);
});

test('a burst keeps the newest fix per collar even when readings arrive out of order', () => {
  const pending = new Map();
  queueLocationReading(pending, reading({ timestamp: time(9), latitude: 10.00009 }));
  queueLocationReading(pending, reading({ timestamp: time(3) }));
  queueLocationReading(pending, reading({ collar_id: 'collar-b', timestamp: time(6) }));
  assert.equal(pending.size, 2);
  assert.equal(pending.get('collar-a').latitude, 10.00009);
});

test('invalid timestamps cannot replace a valid queued fix', () => {
  const pending = new Map();
  queueLocationReading(pending, reading());
  queueLocationReading(pending, reading({ timestamp: 'invalid' }));
  assert.equal(pending.get('collar-a').timestamp, time(3));
});

test('only the currently paired animal changes; unrelated rows retain their references', () => {
  const unpaired = location({ livestock_id: 'unpaired', collar_id: null });
  const other = location({ livestock_id: 'animal-b', collar_id: 'collar-b' });
  const result = apply([location(), unpaired, other], reading());
  assert.equal(result[1], unpaired);
  assert.equal(result[2], other);
  assert.equal(apply([unpaired, other], reading())[0], unpaired);
});

test('a slow refresh preserves a newer live fix while updating server metadata', () => {
  const current = location({ latitude: 10.00009, last_seen_at: time(9), sats: 10 });
  const snapshot = location({ last_seen_at: time(3), animal_status: 'grazing', battery_level: 65 });
  const result = reconcileLocations([current], [snapshot])[0];
  assert.equal(result.latitude, current.latitude);
  assert.equal(result.last_seen_at, current.last_seen_at);
  assert.equal(result.sats, 10);
  assert.equal(result.animal_status, 'grazing');
  assert.equal(result.battery_level, 65);
});

test('an equal-time refresh cannot replace a live coordinate with an old averaged coordinate', () => {
  const current = location({ latitude: 10.00009, last_seen_at: time(9) });
  const snapshot = location({ latitude: 10.00003, last_seen_at: time(9) });
  assert.equal(reconcileLocations([current], [snapshot])[0].latitude, current.latitude);
});

test('a newer server snapshot is accepted on reconnect', () => {
  const snapshot = location({ latitude: 10.00009, last_seen_at: time(9) });
  assert.equal(reconcileLocations([location()], [snapshot])[0], snapshot);
});

test('refresh accepts pairing changes, removes deleted animals and includes new animals', () => {
  const reassigned = location({ collar_id: 'collar-b', latitude: null, longitude: null, last_seen_at: null });
  const added = location({ livestock_id: 'new-animal' });
  const deleted = location({ livestock_id: 'deleted-animal' });
  assert.deepEqual(reconcileLocations([location(), deleted], [reassigned, added]), [reassigned, added]);
});

test('timestamp ordering uses instants rather than formatted strings', () => {
  const current = location({ last_seen_at: '2026-10-13T08:00:09+08:00' });
  assert.equal(apply([current], reading({ timestamp: time(6) }))[0], current);
  assert.equal(apply([current], reading({ timestamp: time(12) }))[0].last_seen_at, time(12));
});
