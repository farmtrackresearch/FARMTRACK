// ===========================================================================
//  TEST 2b - NEO-6M BAUD SCANNER / RAW DUMP
// ---------------------------------------------------------------------------
//  Diagnostic for the case where test_gps reports bytes arriving but
//  sentencesOk=0 AND csumErr=0 - i.e. the module is talking, but not in
//  9600-baud NMEA.
//
//  Cycles UART2 through the bauds a NEO-6M (or a clone) might be set to and
//  reports, for each: how many bytes arrived, how many NMEA sentence starts
//  ('$') were seen, what share of bytes were printable ASCII, and a short
//  text sample.
//
//  Reading the output:
//    The correct baud shows a HIGH '$' count, printable near 100%, and a
//    sample that plainly reads like "$GPGGA,,,,,,0,00,99.99,,,,,,*48" or
//    "$GNRMC,...". Wrong bauds show printable well under 100%, '$'=0, and a
//    sample of mojibake.
//
//    If EVERY baud shows '$'=0 and low printable, the module is not emitting
//    NMEA at all - most likely it has been switched to UBX binary output.
//
//  Wiring:  VCC->5V(VIN)  GND->GND  TX->GPIO16  RX->GPIO17   (as pins.h)
//
//  Build/flash:  pio run -e gps_baud -t upload --upload-port <collar port>
//                pio device monitor --port <collar port> -b 115200
//
//  Read-only: never writes to the module, so its configuration cannot be
//  changed or corrupted by running this.
// ===========================================================================

#include <Arduino.h>
#include "pins.h"

HardwareSerial gpsUart(2);

// 9600 is the NEO-6M factory default; the rest are what a reconfigured module
// or a clone is most commonly found at.
static const uint32_t BAUDS[] = { 9600, 38400, 57600, 115200, 4800, 19200 };
static const int      NBAUDS  = sizeof(BAUDS) / sizeof(BAUDS[0]);

static const uint32_t LISTEN_MS = 3000;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  delay(1000);
  Serial.println("\n=== FarmTrack TEST 2b - NEO-6M BAUD SCAN ===");
  Serial.printf("UART2  RX=GPIO%d  TX=GPIO%d   listening %lums per baud\n\n",
                PIN_GPS_RX, PIN_GPS_TX, (unsigned long)LISTEN_MS);
}

void loop() {
  for (int i = 0; i < NBAUDS; i++) {
    uint32_t baud = BAUDS[i];

    gpsUart.begin(baud, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
    delay(150);
    while (gpsUart.available() > 0) gpsUart.read();  // discard partial frames

    uint32_t bytes = 0, dollars = 0, printable = 0;
    char     sample[81];
    uint8_t  sampleLen = 0;

    uint32_t start = millis();
    while (millis() - start < LISTEN_MS) {
      while (gpsUart.available() > 0) {
        char c = (char)gpsUart.read();
        bytes++;
        if (c == '$') dollars++;
        // Printable ASCII plus CR/LF - what NMEA is made of.
        if ((c >= 32 && c < 127) || c == '\r' || c == '\n') printable++;
        // Collect a readable sample, starting at the first '$' if we see one.
        if (sampleLen < sizeof(sample) - 1 && c >= 32 && c < 127) {
          if (sampleLen > 0 || c == '$') sample[sampleLen++] = c;
        }
      }
    }
    sample[sampleLen] = '\0';

    uint32_t pct = bytes ? (printable * 100UL) / bytes : 0;
    Serial.printf("baud=%-6lu bytes=%-5lu '$'=%-4lu printable=%3lu%%  %s\n",
                  (unsigned long)baud, (unsigned long)bytes,
                  (unsigned long)dollars, (unsigned long)pct,
                  sampleLen ? sample : "(no printable text)");

    gpsUart.end();
    digitalWrite(PIN_LED, i % 2);
    delay(200);
  }

  Serial.println("--- scan complete, repeating in 3s ---\n");
  delay(3000);
}
