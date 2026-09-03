// ===========================================================================
//  TEST 3b - SX1278 LoRa  RECEIVER
// ---------------------------------------------------------------------------
//  Wiring: identical to TEST 3a (VCC->3V3 ONLY, antenna attached).
//
//  Build/flash:  pio run -e lora_rx -t upload -t monitor
//
//  Prints every packet it hears, with RSSI (signal strength, dBm - closer to
//  0 is stronger) and SNR. LED pulses on each packet.
//
//  Controls:  's' or BOOT = stop ,  'r' or BOOT = resume
// ===========================================================================

#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include "pins.h"

static bool running = true;
static bool loraOk  = false;

// --------------------------- stop / resume ---------------------------------
static void stopProgram()   { running = false; digitalWrite(PIN_LED, LOW);
                              Serial.println(">> STOPPED (send 'r' or press BOOT)"); }
static void resumeProgram() { running = true;  Serial.println(">> RESUMED"); }
static bool bootPressed() {
  static int last = HIGH; static uint32_t t = 0;
  int level = digitalRead(PIN_BOOT_BTN);
  if (level != last && millis() - t > 40) { t = millis(); last = level; return level == LOW; }
  return false;
}
static void handleControls() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == 's' || c == 'S') stopProgram();
    if (c == 'r' || c == 'R') resumeProgram();
  }
  if (bootPressed()) running ? stopProgram() : resumeProgram();
}

// ------------------------------ setup/loop --------------------------------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BOOT_BTN, INPUT_PULLUP);
  delay(1000);

  Serial.println("\n=== FarmTrack TEST 3b - LoRa RECEIVER ===");
  LoRa.setPins(PIN_LORA_SS, PIN_LORA_RST, PIN_LORA_DIO0);

  if (LoRa.begin(LORA_FREQ_HZ)) {
    loraOk = true;
    Serial.printf("LoRa OK  freq=%.1f MHz  listening...\n", LORA_FREQ_HZ / 1e6);
  } else {
    Serial.println("LoRa FAILED - check 3V3 power, SPI wiring (18/19/23), NSS/RST/DIO0");
  }
  Serial.println("Controls: 's'/BOOT = stop, 'r'/BOOT = resume");
}

void loop() {
  handleControls();
  if (!running) { delay(50); return; }

  if (!loraOk) {
    static uint32_t last = 0;
    if (millis() - last >= 2000) { last = millis(); Serial.println("LoRa not initialised - fix wiring and reset"); }
    return;
  }

  int packetSize = LoRa.parsePacket();
  if (packetSize > 0) {
    String msg;
    while (LoRa.available()) msg += (char)LoRa.read();
    Serial.printf("RX  \"%s\"  len=%d  rssi=%d dBm  snr=%.1f\n",
                  msg.c_str(), packetSize, LoRa.packetRssi(), LoRa.packetSnr());
    digitalWrite(PIN_LED, HIGH); delay(20); digitalWrite(PIN_LED, LOW);
  }
}
