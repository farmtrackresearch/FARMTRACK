#pragma once
// ===========================================================================
//  FarmTrack - collar <-> gateway wire protocol over LoRa @ 433MHz.
//  Fixed-size packed structs so both sides agree on byte layout without a
//  JSON/CBOR parser on the memory-constrained collar. Shared by collar.cpp
//  and gateway.cpp - keep both in sync if this changes.
// ===========================================================================

#include <cstdint>

#define PROTO_VERSION 1

// Collar -> Gateway (uplink): one GPS reading, sent every few seconds.
struct __attribute__((packed)) UplinkPacket {
  uint8_t  version;    // PROTO_VERSION
  uint32_t deviceId;   // low 32 bits of ESP.getEfuseMac() - identifies the collar
  uint16_t seq;        // increments every send; server uses it to de-dupe
  uint32_t gpsEpoch;   // unix seconds from GPS fix, 0 if not available (server falls back to its own clock)
  int32_t  latE7;      // latitude  * 1e7
  int32_t  lngE7;      // longitude * 1e7
  uint8_t  battery;    // percent 0-100 (hardcoded until a fuel gauge is wired up)
  uint8_t  flags;      // bit0 = has a valid GPS fix
};                      // 20 bytes

// Current fence status for one collar, as decided by the same logic that
// already drives the app (Supabase's detect_geofence_events trigger).
enum FenceState : uint8_t {
  FENCE_STATE_SAFE    = 0,  // grazing / resting - no fence nearby
  FENCE_STATE_WARNING = 1,  // inside the warning buffer of a fence edge
  FENCE_STATE_BREACH  = 2,  // outside every active fence
};

// Gateway -> Collar (downlink): reply to one uplink, sent right after the
// server has processed it, so animal_status is already current.
struct __attribute__((packed)) DownlinkPacket {
  uint8_t  version;
  uint32_t deviceId;   // which collar this reply is for - others ignore it
  uint8_t  state;      // FenceState
};                      // 6 bytes
