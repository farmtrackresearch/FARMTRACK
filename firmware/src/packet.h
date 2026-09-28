#pragma once
// ===========================================================================
//  FarmTrack - collar <-> gateway wire protocol over LoRa @ 433MHz.
//  Fixed-size packed structs so both sides agree on byte layout without a
//  JSON/CBOR parser on the memory-constrained collar. Shared by collar.cpp
//  and gateway.cpp - keep both in sync if this changes.
//
//  Multi-byte fields are little-endian (both ends are ESP32s).
//
//  PROTOCOL v2 - collar and gateway MUST be flashed together. Each side drops
//  packets whose version byte or size doesn't match, so a v1 collar talking
//  to a v2 gateway (or the reverse) just looks like "no reply".
// ===========================================================================

#include <cstdint>

#define PROTO_VERSION 2

// UplinkPacket.flags
#define UPLINK_FLAG_FIX          0x01  // bit0: position is usable (see collar.cpp's fix gate)
#define UPLINK_SATS_SHIFT        1     // bits1-5: satellites USED in the fix (GGA), 0-31
#define UPLINK_SATS_MASK         0x1F
#define UPLINK_FLAG_GPS_OK       0x40  // bit6: GPS sent valid NMEA since the previous uplink
#define UPLINK_FLAG_GPS_RESTART  0x80  // bit7: GPS boot banner seen since the previous uplink

#define BATTERY_UNKNOWN 255            // no voltage divider fitted (BATTERY_SENSE_ENABLED 0)

// Collar -> Gateway (uplink): one GPS reading, sent every few seconds.
struct __attribute__((packed)) UplinkPacket {
  uint8_t  version;    // PROTO_VERSION
  uint32_t deviceId;   // bits 16-47 of ESP.getEfuseMac() - the chip-unique part of the MAC
  uint16_t seq;        // increments every send (wraps at 65535, restarts at 0 on reboot);
                       // the gateway's reply echoes it
  uint32_t gpsEpoch;   // unix seconds of the fix, or 0 when unknown (no usable fix, or the
                       // GPS date/time is stale or implausible) - the server then uses its clock
  int32_t  latE7;      // latitude  * 1e7 (0 without a fix)
  int32_t  lngE7;      // longitude * 1e7 (0 without a fix)
  uint8_t  battery;    // percent 0-100, or BATTERY_UNKNOWN
  uint8_t  flags;      // UPLINK_FLAG_* above. For diagnostics:
                       //   sats=0 with no fix means the antenna sees nothing;
                       //   sats>0 with no fix means it is acquiring normally;
                       //   gps_ok=0 means the module has stopped talking.
};                      // 21 bytes

static_assert(sizeof(UplinkPacket) == 21, "UplinkPacket must stay 21 bytes - the gateway checks the size");

// Current fence status for one collar, as decided by the same logic that
// already drives the app (Supabase's detect_geofence_events trigger).
enum FenceState : uint8_t {
  FENCE_STATE_SAFE    = 0,  // grazing / resting - no fence nearby (also: muted, no fix, stale fix)
  FENCE_STATE_WARNING = 1,  // inside the warning buffer of a fence edge
  FENCE_STATE_BREACH  = 2,  // outside every active fence
};

// Gateway -> Collar (downlink): reply to one uplink, sent right after the
// server has processed it, so animal_status is already current. Same (normal)
// IQ as uplinks; a collar accepts only 8 bytes carrying its own id and seq.
struct __attribute__((packed)) DownlinkPacket {
  uint8_t  version;
  uint32_t deviceId;   // which collar this reply is for - others ignore it
  uint16_t seq;        // the uplink seq this state answers - the collar ignores any other
  uint8_t  state;      // FenceState
};                      // 8 bytes

static_assert(sizeof(DownlinkPacket) == 8, "DownlinkPacket must stay 8 bytes - the collar checks the size");
