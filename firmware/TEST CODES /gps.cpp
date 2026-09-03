// #include "gps.h"
// #include <TinyGPSPlus.h>

// // UART2 on the ESP32. Read-only use: we only ever call .read(), never .write(),
// // so the module's stored configuration is never touched.
// namespace {
//   TinyGPSPlus    gps;
//   HardwareSerial gpsSerial(GPS_UART_NUM);
//   GpsStatus      st;

//   uint32_t lastByteMs   = 0;
//   uint32_t lastWarnMs   = 0;
//   bool     everGotBytes = false;
// }

// void gpsBegin() {
//   memset(&st, 0, sizeof(st));
//   gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
//   Serial.printf("[GPS] UART%d @ %d baud  RX=GPIO%d  TX=GPIO%d\n",
//                 GPS_UART_NUM, GPS_BAUD, GPS_RX_PIN, GPS_TX_PIN);
//   Serial.println("[GPS] waiting for data (cold start can take 1-3 min with sky view)...");
// }

// void gpsUpdate() {
//   // Drain everything the UART has buffered. Cheap and non-blocking.
//   while (gpsSerial.available() > 0) {
//     char c = (char)gpsSerial.read();
//     st.charsRx++;
//     lastByteMs   = millis();
//     everGotBytes = true;
//     gps.encode(c);
//   }

//   const uint32_t now = millis();

//   // ---- refresh status from the parser ----
//   st.wiringOk    = everGotBytes;
//   st.streaming   = everGotBytes && (now - lastByteMs < 3000);
//   st.sentencesOk = gps.passedChecksum();
//   st.checksumErr = gps.failedChecksum();
//   st.satellites  = gps.satellites.isValid() ? (uint8_t)gps.satellites.value() : 0;
//   st.hdop        = gps.hdop.isValid() ? gps.hdop.hdop() : 0.0;

//   st.hasFix = gps.location.isValid() &&
//               gps.location.age() < 5000 &&
//               st.satellites >= 3;

//   if (gps.location.isValid()) { st.lat = gps.location.lat();  st.lng = gps.location.lng(); }
//   if (gps.altitude.isValid())   st.altitudeM = gps.altitude.meters();
//   if (gps.speed.isValid())      st.speedKmph = gps.speed.kmph();
//   if (gps.date.isValid()) { st.year = gps.date.year();  st.month = gps.date.month();  st.day = gps.date.day(); }
//   if (gps.time.isValid()) { st.hour = gps.time.hour();  st.minute = gps.time.minute(); st.second = gps.time.second(); }

//   // ---- diagnostics: fail loudly, but never in a way that harms hardware ----
//   if (now - lastWarnMs >= 5000) {
//     lastWarnMs = now;
//     if (!everGotBytes) {
//       Serial.println("[GPS] WARN: no bytes yet. Check NEO-6M TX -> GPIO16, common GND, VCC power.");
//     } else if (now - lastByteMs > 3000) {
//       Serial.println("[GPS] WARN: stream stopped. Loose jumper or brown-out on the module.");
//     } else if (st.sentencesOk == 0 && st.charsRx > 300) {
//       Serial.println("[GPS] WARN: bytes arriving but no valid NMEA - baud mismatch? Try GPS_BAUD 38400.");
//     }
//   }
// }

// bool   gpsHasFix()                { return st.hasFix; }
// double gpsLat()                   { return st.lat; }
// double gpsLng()                   { return st.lng; }
// const GpsStatus& gpsGetStatus()   { return st; }

// void gpsPrintStatus() {
//   if (st.hasFix) {
//     Serial.printf(
//       "[GPS] FIX  %.6f, %.6f  sats=%u hdop=%.1f  alt=%.1fm  spd=%.1fkm/h  %04u-%02u-%02u %02u:%02u:%02uZ\n",
//       st.lat, st.lng, st.satellites, st.hdop, st.altitudeM, st.speedKmph,
//       st.year, st.month, st.day, st.hour, st.minute, st.second);
//   } else {
//     Serial.printf(
//       "[GPS] searching  sats=%u  rx=%lu B  ok=%lu  csumErr=%lu  link=%s\n",
//       st.satellites, (unsigned long)st.charsRx, (unsigned long)st.sentencesOk,
//       (unsigned long)st.checksumErr,
//       !st.wiringOk ? "NO DATA" : (st.streaming ? "streaming" : "stalled"));
//   }
// }
