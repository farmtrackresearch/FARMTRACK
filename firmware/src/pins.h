#pragma once
// ===========================================================================
//  FarmTrack - ESP32 DevKit (30-pin) pin map. Shared by every component test.
// ===========================================================================

// ---- on-board ----
#define PIN_LED        2      // blue LED
#define PIN_BOOT_BTN   0      // BOOT button, active LOW (used for stop/resume)

// ---- NEO-6M GPS  (ESP32 hardware UART2) ----
//   GPS VCC -> 5V (VIN)   GPS GND -> GND
//   GPS TX  -> GPIO16     GPS RX  -> GPIO17
#define PIN_GPS_RX     16    // ESP32 <- GPS TX
#define PIN_GPS_TX     17    // ESP32 -> GPS RX
#define GPS_BAUD       9600  // NEO-6M factory default

// ---- SX1278 LoRa  (ESP32 VSPI: SCK=18, MISO=19, MOSI=23) ----
//   LoRa VCC -> 3V3 ONLY (never 5V)     LoRa GND -> GND
//   SCK->18  MISO->19  MOSI->23  NSS->5  RST->14  DIO0->26
//   ALWAYS attach the antenna before powering / transmitting.
#define PIN_LORA_SS     5
#define PIN_LORA_RST   14
#define PIN_LORA_DIO0  26
#define LORA_FREQ_HZ   433E6  // SX1278 = 433 MHz. Match your module + local law.
