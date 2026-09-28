#pragma once
// ===========================================================================
//  FarmTrack - ESP32 DevKit (30-pin) pin map. Shared by every component test.
// ===========================================================================

// ---- on-board ----
// Blue LED - but see the DIO0 note below: on the as-built boards the radio's
// DIO0 wire lands on this pin, so EVERY sketch keeps it an INPUT. Driving it
// shorts the ESP32's output against the radio's and sags the 3V3 rail.
#define PIN_LED        2
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
//
//   AS BUILT: on the current collar and gateway, DIO0 is physically wired to
//   GPIO2, not GPIO26. The firmware polls the radio over SPI and never reads
//   DIO0, so the link works either way - but GPIO2 must stay an input until
//   the jumper is moved to GPIO26.
#define PIN_LORA_SS     5
#define PIN_LORA_RST   14
#define PIN_LORA_DIO0  26
#define LORA_FREQ_HZ   433E6  // SX1278 = 433 MHz. Match your module + local law.
#define LORA_BW_HZ     125E3  // the SX1278's power-on default, set explicitly so both ends are pinned
// Spreading factor 9 rather than the library's default of 7. Measured noise
// floor at this site is about -86dBm (35dB above thermal - 433MHz ISM is
// shared with car remotes and gate openers), which at SF7 left the link
// failing below RSSI -90. SF9 lowers the demodulator's SNR limit from
// -7.5dB to -12.6dB, roughly doubling usable range, at 185ms airtime per
// 21-byte uplink - 6% duty cycle on a 3-second interval.
#define LORA_SF        9
// Private channel word so collar/gateway ignore other LoRa gear nearby.
// The SX127x powers up with 0x12 (the LoRa library never changes it unless
// told to) and public LoRaWAN networks use 0x34; 0xF3 is neither, so a
// neighbour's default-config device won't be heard.
#define LORA_SYNC_WORD 0xF3
// Transmit power, dBm (2-17, PA_BOOST). 17 is the library default and the
// design value. At 17 dBm the SX1278 draws ~90-120mA while sending, and on the
// bench (27 Sep 2026) the collar's radio reset within 60ms of every 17 dBm
// send - its 3.3V supply sagged - while every 2 dBm send finished. Until the
// radio has a supply that holds (a 100-470uF capacitor across its VCC/GND and
// a low-dropout 3.3V regulator, see firmware/README.md), use the highest level
// the lora_diag power sweep reports as reliable. Lower power = shorter range;
// it does not need to match between boards.
#ifndef LORA_TX_DBM
#define LORA_TX_DBM    17
#endif
// Every value in this block must match on BOTH boards - a mismatch doesn't
// degrade the link, it removes it. lora_link.h applies them all.

// ---- Piezo buzzer (collar only) - audio deterrent on fence approach/breach ----
//   Buzzer +  -> GPIO27     Buzzer -  -> GND
#define PIN_BUZZER     27

// ---- Battery sense (collar only) ----
//   LiPo+ -> 100k -> GPIO35 -> 100k -> GND,  plus 100nF from GPIO35 to GND
// GPIO35 is an input-only ADC1 pin, so it is free on every build and keeps
// working when WiFi is on (ADC2 does not). A 4.2V cell reads 2.1V at the pin,
// inside the 11dB attenuation range. Leave BATTERY_SENSE_ENABLED at 0 until
// the divider is actually fitted: a floating pin reads garbage, and 255
// ("unknown") is more honest than a made-up percentage.
#ifndef BATTERY_SENSE_ENABLED
#define BATTERY_SENSE_ENABLED 0
#endif
#define PIN_BATTERY_ADC        35
#define BATTERY_DIVIDER_RATIO  2.0f   // Vbattery / Vpin = (R_top + R_bottom) / R_bottom
