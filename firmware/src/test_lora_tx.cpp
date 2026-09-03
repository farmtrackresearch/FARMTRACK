// ===========================================================================
//  TEST 3a - SX1278 LoRa  SENDER
// ---------------------------------------------------------------------------
//  Wiring (SX1278 -> ESP32):  VCC->3V3 ONLY   GND->GND
//    SCK->GPIO18  MISO->GPIO19  MOSI->GPIO23  NSS->GPIO5  RST->GPIO14  DIO0->GPIO26
//    *** attach the antenna BEFORE powering - TX with no antenna can kill the PA
//
//  Build/flash:  pio run -e lora_tx -t upload -t monitor
//
//  Sends "FarmTrack #<n>" once per second. Run TEST 3b on a second board to
//  confirm the link. LED blinks on each send.
//
//  Controls:  's' or BOOT = stop ,  'r' or BOOT = resume
// ===========================================================================

#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include "pins.h"

static bool running = true;
static bool loraOk  = false;
static uint32_t counter = 0;

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

  Serial.println("\n=== FarmTrack TEST 3a - LoRa SENDER ===");
  LoRa.setPins(PIN_LORA_SS, PIN_LORA_RST, PIN_LORA_DIO0);

  if (LoRa.begin(LORA_FREQ_HZ)) {
    loraOk = true;
    Serial.printf("LoRa OK  freq=%.1f MHz  SS=%d RST=%d DIO0=%d\n",
                  LORA_FREQ_HZ / 1e6, PIN_LORA_SS, PIN_LORA_RST, PIN_LORA_DIO0);
  } else {
    Serial.println("LoRa FAILED - check 3V3 power, SPI wiring (18/19/23), NSS/RST/DIO0");
  }
  Serial.println("Controls: 's'/BOOT = stop, 'r'/BOOT = resume");
}

void loop() {
  handleControls();
  if (!running) { delay(50); return; }

  if (!loraOk) {                    // keep retrying instead of hanging
    static uint32_t last = 0;
    if (millis() - last >= 2000) {
      last = millis();
      Serial.println("LoRa not initialised - fix wiring and reset");
    }
    return;
  }

  static uint32_t last = 0;
  if (millis() - last >= 1000) {
    last = millis();
    counter++;

    LoRa.beginPacket();
    LoRa.printf("FarmTrack #%lu", (unsigned long)counter);
    LoRa.endPacket();               // blocks until sent (~tens of ms)

    Serial.printf("sent  #%lu\n", (unsigned long)counter);
    digitalWrite(PIN_LED, HIGH); delay(20); digitalWrite(PIN_LED, LOW);
  }
}
