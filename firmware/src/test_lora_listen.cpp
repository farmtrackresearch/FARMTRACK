// ===========================================================================
//  TEST 3d - SX1278 LoRa RECEIVE DIAGNOSTIC
// ---------------------------------------------------------------------------
//  For a board whose radio sends fine but never hears anything (the collar
//  logs "no reply from gateway" while the gateway logs "TX reply").
//
//  Build/flash:  pio run -e lora_listen -t upload -t monitor
//
//  Run it on the board under test while another board transmits - lora_diag
//  (bursts of 18 packets every 20 s) or lora_tx (one packet every 2 s). It
//  listens continuously on the real link profile (lora_link.h) and every 2 s
//  prints what the receiver saw, read straight from the radio's registers:
//    ok       packets received with a good CRC
//    crc_err  packets received but corrupted
//    headers  packet starts detected (preamble + header)
//    max      strongest signal sensed in those 2 s, even if nothing decoded
//    floor    weakest reading = background noise
//
//  How to read it while the other board is transmitting:
//    ok > 0                      -> this receiver works.
//    headers/crc_err > 0, ok = 0 -> it hears the packets but they arrive
//                                   corrupted: check the antenna and its
//                                   connector on both boards.
//    max rises well above floor, -> radio energy reaches it but nothing is
//    headers = 0                    decoded: settings differ, or the
//                                   receive path is faulty.
//    max stays near floor        -> nothing reaches the receiver: antenna
//                                   missing/broken, or the module's receive
//                                   path is damaged.
// ===========================================================================

#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include "pins.h"
#include "lora_link.h"

#define REG_OP_MODE        0x01
#define REG_IRQ_FLAGS      0x12
#define REG_PKT_RSSI_VALUE 0x1A
#define REG_RSSI_VALUE     0x1B
#define IRQ_RX_DONE        0x40
#define IRQ_CRC_ERROR      0x20
#define IRQ_VALID_HEADER   0x10
#define RSSI_OFFSET_LF     164   // SX1278, 433 MHz band: dBm = value - 164

static uint8_t regRead(uint8_t addr) {
  SPI.beginTransaction(SPISettings(8E6, MSBFIRST, SPI_MODE0));
  digitalWrite(PIN_LORA_SS, LOW);
  SPI.transfer(addr & 0x7F);
  uint8_t v = SPI.transfer(0x00);
  digitalWrite(PIN_LORA_SS, HIGH);
  SPI.endTransaction();
  return v;
}

static void regWrite(uint8_t addr, uint8_t v) {
  SPI.beginTransaction(SPISettings(8E6, MSBFIRST, SPI_MODE0));
  digitalWrite(PIN_LORA_SS, LOW);
  SPI.transfer(addr | 0x80);
  SPI.transfer(v);
  digitalWrite(PIN_LORA_SS, HIGH);
  SPI.endTransaction();
}

static bool radioOk = false;

static void startListening() {
  radioOk = loraBeginLink();
  if (!radioOk) return;
  regWrite(REG_IRQ_FLAGS, 0xFF);
  LoRa.receive();   // continuous receive; we poll the flags ourselves
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, INPUT);   // never an output - DIO0 may be on this pin (pins.h)
  delay(1000);
  Serial.println("\n=== FarmTrack TEST 3d - LoRa RECEIVE DIAGNOSTIC ===");
  startListening();
  Serial.println(radioOk ? "LoRa OK - listening continuously, summary every 2s"
                         : "LoRa FAILED - radio not answering on SPI");
}

void loop() {
  static uint32_t windowStart = millis();
  static uint32_t lastSample  = 0;
  static int ok = 0, crcErr = 0, headers = 0, lastPktRssi = 0;
  static int maxRssi = -200, minRssi = 0;

  if (!radioOk) {
    delay(2000);
    Serial.println("LoRa not initialised - retrying");
    startListening();
    return;
  }

  uint8_t irq = regRead(REG_IRQ_FLAGS);
  if (irq & IRQ_VALID_HEADER) headers++;
  if (irq & IRQ_RX_DONE) {
    if (irq & IRQ_CRC_ERROR) crcErr++;
    else ok++;
    lastPktRssi = (int)regRead(REG_PKT_RSSI_VALUE) - RSSI_OFFSET_LF;
  }
  if (irq) regWrite(REG_IRQ_FLAGS, irq);

  // Continuous receive should never leave RX; if it did (e.g. a reset),
  // say so and start again.
  uint8_t op = regRead(REG_OP_MODE);
  if (op != 0x85) {
    Serial.printf("radio left receive mode (op=0x%02X) - restarting it\n", op);
    LoRa.end();
    startListening();
    return;
  }

  if (millis() - lastSample >= 5) {
    lastSample = millis();
    int rssi = (int)regRead(REG_RSSI_VALUE) - RSSI_OFFSET_LF;
    if (rssi > maxRssi) maxRssi = rssi;
    if (rssi < minRssi) minRssi = rssi;
  }

  if (millis() - windowStart >= 2000) {
    Serial.printf("2s: ok=%d crc_err=%d headers=%d max=%d dBm floor=%d dBm\n",
                  ok, crcErr, headers, maxRssi, minRssi);
    if (ok || crcErr) Serial.printf("    last packet rssi=%d dBm\n", lastPktRssi);
    windowStart = millis();
    ok = crcErr = headers = 0;
    maxRssi = -200;
    minRssi = 0;
  }
}
