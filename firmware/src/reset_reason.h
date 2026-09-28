#pragma once
// ===========================================================================
//  FarmTrack - why did this board last restart? Printed at boot by the collar
//  and the gateway as "reset reason: <NAME>". In a field log, BROWNOUT points
//  at the power supply, TASK_WDT at a hang the watchdog caught, SW at a
//  deliberate ESP.restart() (the line just before it says why), POWERON/EXT
//  at a normal power-up or EN-button press.
// ===========================================================================

#include <esp_system.h>

static inline const char* resetReasonName(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_POWERON:   return "POWERON";
    case ESP_RST_EXT:       return "EXT";
    case ESP_RST_SW:        return "SW";
    case ESP_RST_PANIC:     return "PANIC";
    case ESP_RST_INT_WDT:   return "INT_WDT";
    case ESP_RST_TASK_WDT:  return "TASK_WDT";
    case ESP_RST_WDT:       return "WDT";
    case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
    case ESP_RST_BROWNOUT:  return "BROWNOUT";
    case ESP_RST_SDIO:      return "SDIO";
    default:                return "UNKNOWN";
  }
}
