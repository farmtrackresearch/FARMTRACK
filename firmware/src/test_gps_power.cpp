// ===========================================================================
//  TEST 2c - GPS UNDER REDUCED ELECTRICAL LOAD
// ---------------------------------------------------------------------------
//  For the case where the NEO-6M emits ~18 bytes of its boot banner and
//  restarts ~12x/sec. That rate is too fast to be a real reboot cycle - it is
//  the signature of a brownout oscillation: the module powers up, starts
//  drawing current, the rail sags below its regulator's threshold, it drops,
//  current falls, the rail recovers, repeat.
//
//  This sketch tests that WITHOUT unplugging anything, by shedding every load
//  it can in software:
//     - SX1278 put into sleep mode      (~10mA -> ~1uA, same as unplugging it)
//     - CPU clocked down to 80MHz       (roughly halves the ESP32's draw)
//     - WiFi and Bluetooth radios off
//
//  Then it holds UART2 at 9600 and prints every burst of bytes with the gap
//  that preceded it, so the failure pattern is visible in the timing rather
//  than inferred from counters.
//
//  Reading the output:
//    bursts of ~18 bytes every ~80ms   -> still brownout looping
//    bursts growing past "u-blox ag"   -> load shedding helped; supply is
//                                         marginal and this is the cause
//    long readable NMEA with $GPGGA    -> fixed under reduced load
//
//  If it still loops here, the supply is not the constraint and the module's
//  own regulator has most likely failed.
//
//  Build/flash:  pio run -e gps_power -t upload --upload-port <collar port>
//                pio device monitor --port <collar port> -b 115200
//
//  Read-only with respect to the GPS: never writes to that module.
// ===========================================================================

#include <Arduino.h>
#include <WiFi.h>
#include <SPI.h>
#include <LoRa.h>
#include "pins.h"

HardwareSerial gpsUart(2);

// A burst is considered finished after this much silence on the line.
static const uint32_t GAP_MS = 50;

static char     buf[400];
static uint16_t len        = 0;
static uint32_t lastByteMs = 0;
static uint32_t lastBurstMs= 0;
static uint32_t burstCount = 0;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, INPUT);   // never an output - DIO0 may be on this pin (pins.h)
  delay(1000);
  Serial.println("\n=== FarmTrack TEST 2c - GPS UNDER REDUCED LOAD ===");

  // --- shed every load we can reach from software --------------------------
  WiFi.mode(WIFI_OFF);
  btStop();
  setCpuFrequencyMhz(80);
  Serial.printf("CPU %lu MHz, WiFi off, BT off\n",
                (unsigned long)getCpuFrequencyMhz());

  // Sleeping the radio frees the same current as pulling it off the board.
  LoRa.setPins(PIN_LORA_SS, PIN_LORA_RST, PIN_LORA_DIO0);
  if (LoRa.begin(LORA_FREQ_HZ)) {
    LoRa.sleep();
    Serial.println("SX1278 -> sleep mode (radio load removed, no rewiring)");
  } else {
    Serial.println("SX1278 did not respond - skipping (already unpowered?)");
  }

  gpsUart.begin(GPS_BAUD, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
  Serial.printf("GPS on UART2 RX=GPIO%d @ %d baud\n", PIN_GPS_RX, GPS_BAUD);
  Serial.println("Printing each burst as [gap since last] length: content\n");
}

void loop() {
  while (gpsUart.available() > 0) {
    char c = (char)gpsUart.read();
    if (len < sizeof(buf) - 1) buf[len++] = c;
    lastByteMs = millis();
  }

  if (len > 0 && millis() - lastByteMs > GAP_MS) {
    buf[len] = '\0';
    uint32_t now = millis();
    uint32_t gap = lastBurstMs ? (now - lastBurstMs) : 0;
    lastBurstMs  = now;

    Serial.printf("[%5lums] %3u bytes: ", (unsigned long)gap, len);
    for (uint16_t i = 0; i < len; i++) {
      char c = buf[i];
      if (c >= 32 && c < 127)      Serial.print(c);
      else if (c == '\r')          Serial.print("<CR>");
      else if (c == '\n')          Serial.print("<LF>");
      else                         Serial.printf("<%02X>", (uint8_t)c);
    }
    Serial.println();

    len = 0;
    burstCount++;
  }
}
