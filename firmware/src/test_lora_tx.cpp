// ===========================================================================
//  TEST 3a - SX1278 LoRa  SENDER
// ---------------------------------------------------------------------------
//  Wiring (SX1278 -> ESP32):  VCC->3V3 ONLY   GND->GND
//    SCK->GPIO18  MISO->GPIO19  MOSI->GPIO23  NSS->GPIO5  RST->GPIO14  DIO0->GPIO26
//    *** attach the antenna BEFORE powering - TX with no antenna can kill the PA
//
//  Build/flash:  pio run -e lora_tx -t upload -t monitor
//
//  Sends "FarmTrack #<n>" every 2 seconds using the REAL link profile
//  (lora_link.h: SF9, CRC on, sync word 0xF3) - the same settings as the
//  collar and gateway, so a pass here means those two can hear each other
//  too. Run TEST 3b on a second board to confirm the link. A real gateway
//  in range will log these as "ignored packet" - that is expected.
//
//  Every 2s, not 1s: at SF9 each packet is ~165ms on air, and 2s keeps the
//  duty cycle under 10%.
//
//  Controls:  's' or BOOT = stop ,  'r' or BOOT = resume
// ===========================================================================

#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include "pins.h"
#include "lora_link.h"

static bool running = true;
static bool loraOk  = false;
static uint32_t counter = 0;

// --------------------------- stop / resume ---------------------------------
static void stopProgram()   { running = false; Serial.println(">> STOPPED (send 'r' or press BOOT)"); }
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
  pinMode(PIN_LED, INPUT);   // never an output - DIO0 may be on this pin (pins.h)
  pinMode(PIN_BOOT_BTN, INPUT_PULLUP);
  delay(1000);

  Serial.println("\n=== FarmTrack TEST 3a - LoRa SENDER ===");
  if (loraBeginLink()) {
    loraOk = true;
    Serial.printf("LoRa OK  freq=%.1f MHz  SF=%d  sync=0x%02X  CRC on  SS=%d RST=%d\n",
                  LORA_FREQ_HZ / 1e6, LORA_SF, LORA_SYNC_WORD, PIN_LORA_SS, PIN_LORA_RST);
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
  if (millis() - last >= 2000) {
    last = millis();
    counter++;

    char msg[24];
    int len = snprintf(msg, sizeof(msg), "FarmTrack #%lu", (unsigned long)counter);
    if (loraSend((const uint8_t*)msg, len)) {
      Serial.printf("sent  #%lu\n", (unsigned long)counter);
    } else {
      Serial.printf("send #%lu TIMED OUT - radio not responding\n", (unsigned long)counter);
    }
  }
}
