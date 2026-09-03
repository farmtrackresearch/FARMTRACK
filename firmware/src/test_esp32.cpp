// ===========================================================================
//  TEST 1 - ESP32 board sanity check
// ---------------------------------------------------------------------------
//  No external parts needed. Verifies: USB serial, the on-board LED, and that
//  the chip boots cleanly.
//
//  Build/flash:  pio run -e esp32 -t upload -t monitor
//
//  Expected: chip info printed once, then "tick" every second while the
//  on-board LED blinks at 1 Hz.
//
//  Controls:  's' or BOOT button = stop (LED off) ,  'r' or BOOT = resume
// ===========================================================================

#include <Arduino.h>
#include "pins.h"

static bool running = true;

static void stopProgram() {
  running = false;
  digitalWrite(PIN_LED, LOW);
  Serial.println(">> STOPPED (send 'r' or press BOOT to resume)");
}

static void resumeProgram() {
  running = true;
  Serial.println(">> RESUMED");
}

// debounced HIGH->LOW on the BOOT button
static bool bootPressed() {
  static int last = HIGH;
  static uint32_t t = 0;
  int level = digitalRead(PIN_BOOT_BTN);
  if (level != last && millis() - t > 40) {
    t = millis();
    last = level;
    return level == LOW;
  }
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

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BOOT_BTN, INPUT_PULLUP);
  delay(1000);

  Serial.println("\n=== FarmTrack TEST 1 - ESP32 sanity ===");
  Serial.printf("Chip   : %s  rev %d\n", ESP.getChipModel(), ESP.getChipRevision());
  Serial.printf("Cores  : %d\n", ESP.getChipCores());
  Serial.printf("Flash  : %u MB\n", ESP.getFlashChipSize() / (1024 * 1024));
  Serial.printf("Free heap: %u bytes\n", ESP.getFreeHeap());
  Serial.println("Controls: 's'/BOOT = stop, 'r'/BOOT = resume");
}

void loop() {
  handleControls();
  if (!running) { delay(50); return; }

  static uint32_t last = 0;
  static bool on = false;
  if (millis() - last >= 500) {
    last = millis();
    on = !on;
    digitalWrite(PIN_LED, on);
    if (on) Serial.printf("tick  uptime=%lus  heap=%u\n",
                          millis() / 1000, ESP.getFreeHeap());
  }
}
