// ===========================================================================
//  TEST 3c - SX1278 LoRa TRANSMIT DIAGNOSTIC
// ---------------------------------------------------------------------------
//  For a board whose radio starts ("LoRa OK") but never finishes a send:
//  lora_tx stops after "LoRa OK", or the collar is restarted by its watchdog
//  (reset reason: TASK_WDT) before printing any "TX seq=" line.
//
//  Build/flash:  pio run -e lora_diag -t upload -t monitor
//
//  Every 20 s it runs a power sweep: three short sends at 2, 5, 8, 11, 14
//  and 17 dBm, and prints how many finished at each level and the highest
//  level that works on this supply. trySend(dbm, true) prints the chip's
//  mode and flags while it sends, read straight from its registers:
//    op   = operating mode (TX while sending, STANDBY when done)
//    irq  = interrupt flags (0x08 = TxDone, the "finished sending" flag)
//
//  How to read the result line of each send:
//    SENT at both powers         -> radio and power are fine; the fault is
//                                   in the program that failed.
//    SENT at 2 dBm, not at 17    -> the 3.3 V supply sags when the radio
//                                   transmits at full power (brownout).
//    RESET during the send       -> the radio chip lost power or its reset
//                                   line mid-send: check the VCC, GND and
//                                   RST (GPIO14) wires to the SX1278.
//    stuck in TX / FSTX          -> the chip can't start or finish sending:
//                                   likely a damaged module.
//
//  A gateway in range logs these packets as "ignored packet len=8 ver=70"
//  (at most every 30 s) - that line proves the send reached the air.
// ===========================================================================

#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include "pins.h"
#include "lora_link.h"

// SX127x registers, read directly so the library can't change the radio's
// state while we look (its own register access is private).
#define REG_OP_MODE   0x01
#define REG_PA_CONFIG 0x09
#define REG_IRQ_FLAGS 0x12
#define REG_VERSION   0x42
#define IRQ_TX_DONE   0x08

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

// Bit 7 of the mode register is LoRa mode. The chip powers up (or comes back
// from a reset) in FSK mode with that bit clear.
static const char* modeName(uint8_t op) {
  if (!(op & 0x80)) return "FSK - chip was reset";
  switch (op & 0x07) {
    case 0: return "SLEEP";
    case 1: return "STANDBY";
    case 2: return "FSTX";
    case 3: return "TX";
    case 4: return "FSRX";
    case 5: return "RX-CONT";
    case 6: return "RX-SINGLE";
    default: return "CAD";
  }
}

static bool radioOk = false;

static bool trySend(int dbm, bool verbose) {
  LoRa.idle();
  LoRa.setTxPower(dbm);
  regWrite(REG_IRQ_FLAGS, 0xFF);   // start from clean flags
  uint8_t op0 = regRead(REG_OP_MODE);
  if (verbose)
    Serial.printf("\n--- send at %d dBm   before: op=0x%02X (%s) pa=0x%02X version=0x%02X\n",
                  dbm, op0, modeName(op0), regRead(REG_PA_CONFIG), regRead(REG_VERSION));

  const uint8_t msg[8] = {'F', 'T', '-', 'D', 'I', 'A', 'G', (uint8_t)dbm};
  LoRa.beginPacket();
  LoRa.write(msg, sizeof(msg));
  LoRa.endPacket(true);            // start sending, don't wait

  uint32_t start = millis();
  uint8_t lastOp = 0xFF, lastIrq = 0xFF, op = 0, irq = 0;
  bool sent = false, reset = false;
  while (millis() - start < 1000) {
    op  = regRead(REG_OP_MODE);
    irq = regRead(REG_IRQ_FLAGS);
    if (verbose && (op != lastOp || irq != lastIrq)) {
      Serial.printf("  t=%4lums  op=0x%02X (%s)  irq=0x%02X%s\n", (unsigned long)(millis() - start),
                    op, modeName(op), irq, (irq & IRQ_TX_DONE) ? "  TxDone" : "");
      lastOp = op;
      lastIrq = irq;
    }
    if (irq & IRQ_TX_DONE) { sent = true; break; }
    if (!(op & 0x80)) { reset = true; break; }
    delay(1);
  }
  uint32_t took = millis() - start;

  if (!verbose) {
    // quiet mode (power sweep): the caller prints one summary line per level
  } else if (sent) {
    Serial.printf("  RESULT: SENT at %d dBm in %lums\n", dbm, (unsigned long)took);
  } else if (reset) {
    Serial.printf("  RESULT: RESET during the send at %d dBm after %lums - the radio lost power or its reset line\n",
                  dbm, (unsigned long)took);
  } else {
    Serial.printf("  RESULT: NOT SENT at %d dBm - after 1s the radio is still in %s (irq=0x%02X)\n",
                  dbm, modeName(op), irq);
  }

  regWrite(REG_IRQ_FLAGS, 0xFF);
  if (sent) {
    LoRa.idle();
  } else {
    // Put the radio back into a known LoRa state for the next attempt.
    LoRa.end();
    radioOk = loraBeginLink();
    if (!radioOk) Serial.println("  radio did not restart - check the SX1278 wiring");
  }
  return sent;
}

// Power sweep: three sends at each level, lowest first, then one line per
// level and the highest level at which every send finished. Use that level
// (or lower) as LORA_TX_DBM in pins.h until the radio's 3.3 V supply is fixed.
static void powerSweep() {
  static const int levels[] = {2, 5, 8, 11, 14, 17};
  int best = -1;
  Serial.println("\n=== power sweep: 3 sends per level ===");
  for (int dbm : levels) {
    int ok = 0;
    for (int i = 0; i < 3 && radioOk; i++) {
      if (trySend(dbm, false)) ok++;
      delay(400);
    }
    Serial.printf("  %2d dBm: %d/3 sent%s\n", dbm, ok, ok == 3 ? "" : "  <- radio reset (supply sags)");
    if (ok == 3) best = dbm; else break;   // above the first failing level only gets worse
  }
  if (best < 0) Serial.println("  RESULT: no power level works - check the SX1278 VCC/GND wiring");
  else Serial.printf("  RESULT: highest power that sends reliably on this supply: %d dBm\n", best);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, INPUT);   // never an output - DIO0 may be on this pin (pins.h)
  delay(1000);
  Serial.println("\n=== FarmTrack TEST 3c - LoRa TRANSMIT DIAGNOSTIC ===");
  radioOk = loraBeginLink();
  Serial.println(radioOk ? "LoRa OK - first send in 2s" : "LoRa FAILED - radio not answering on SPI");
}

void loop() {
  static uint32_t last = 0;
  static bool first = true;
  if (!first && millis() - last < 20000) return;
  first = false;
  last = millis();
  if (!radioOk) {
    Serial.println("LoRa not initialised - retrying");
    radioOk = loraBeginLink();
    return;
  }
  powerSweep();
}
