#pragma once
// ===========================================================================
//  FarmTrack - the LoRa link profile, in one place. The collar, the gateway
//  and the lora_tx / lora_rx bench tests all start the radio through
//  loraBeginLink(), so they cannot drift apart: a board with a different
//  spreading factor, bandwidth or sync word hears nothing from the others.
// ===========================================================================

#include <Arduino.h>
#include <LoRa.h>
#include "pins.h"

static inline bool loraBeginLink() {
  LoRa.setPins(PIN_LORA_SS, PIN_LORA_RST, PIN_LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ_HZ)) return false;
  // Payload CRC on. The library leaves it off by default, which means a packet
  // corrupted in transit is handed to the application as if it were valid -
  // at the edge of range that produced phantom collars and bogus "fix=1
  // sats=10" readings. With CRC on, the radio drops damaged packets itself and
  // parsePacket() never returns them.
  LoRa.enableCrc();
  LoRa.setSignalBandwidth(LORA_BW_HZ);
  LoRa.setSpreadingFactor(LORA_SF);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.setTxPower(LORA_TX_DBM);
  return true;
}

// Sends one packet and waits until it has left the antenna: ~185ms for a
// 21-byte uplink at SF9/125kHz, ~124ms for an 8-byte reply.
//
// This is the library's blocking endPacket(), which waits for the radio's
// TxDone flag - the same call v1 used on this hardware. v2 first started the
// send with endPacket(true) and polled beginPacket() to see when it had
// finished. On the bench (27 Sep 2026) that version reported "sent" every
// cycle while the gateway heard nothing: the collar's radio was resetting
// mid-send because of a loose supply wire (lora_diag showed it), and a reset
// radio also reads as "not transmitting", so the probe hid the fault. Waiting
// for TxDone makes a send that never completes visible. If the radio stops
// answering mid-send, the task watchdog (30s on the collar, 60s on the
// gateway) restarts the board instead of leaving it hung.
static inline bool loraSend(const uint8_t* buf, size_t len) {
  if (!LoRa.beginPacket()) return false;  // still busy with a previous packet
  LoRa.write(buf, len);
  LoRa.endPacket();                       // blocking: returns once TxDone is set
  return true;
}
