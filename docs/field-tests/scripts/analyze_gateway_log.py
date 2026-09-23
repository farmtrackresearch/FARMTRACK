#!/usr/bin/env python3
"""
Parse a FarmTrack gateway serial log and report LoRa link quality per
measurement point.

Input format is whatever `pio device monitor -f time -f log2file` writes for
firmware/src/gateway.cpp, i.e. lines like:

    00:41:07.512 > RX from EC82C34C seq=412 fix=1 sats=7 rssi=-84 snr=8.2
    00:41:09.980 > TX reply state=2
    00:41:31.004 > upload failed, HTTP -1:
    00:41:31.007 > no state to relay back - skipping downlink reply this cycle
    00:42:02.113 > === FarmTrack GATEWAY ===

The gateway prints its RX line BEFORE it attempts the HTTPS upload
(gateway.cpp line 154 vs 159), so RSSI/SNR/PDR figures produced here remain
valid even across stretches where uploads were failing. Only the Supabase
delivery numbers depend on the upload path.

Packet delivery ratio is computed from the collar's seq counter, NOT from an
assumed packet interval. collar.cpp increments seq on every transmit, but its
cycle stretches from ~3s to ~4s whenever no downlink reply arrives, so any
"expected packets = window / 3s" calculation would be wrong exactly at the
marginal points that matter most.

    PDR = distinct seq values received / (max_seq - min_seq + 1)

Usage:
    python3 analyze_gateway_log.py GATEWAY.log --points points.csv
    python3 analyze_gateway_log.py GATEWAY.log            # whole-log summary only

points.csv (header required; times are laptop clock HH:MM:SS, same clock the
log is stamped with):

    point,label,dist_m,start,end
    P0,reference point,0,00:35:00,00:50:00
    P1,first pole past gate,52,00:53:10,00:54:40
"""

import argparse
import csv
import re
import statistics
import sys
from datetime import datetime, timedelta

# 00:41:07.512 > RX from EC82C34C seq=412 fix=1 sats=7 rssi=-84 snr=8.2
RX_RE = re.compile(
    r"(?P<t>\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s*>?\s*"
    r"RX from (?P<dev>[0-9A-Fa-f]{8}) "
    r"seq=(?P<seq>\d+) fix=(?P<fix>\d+) sats=(?P<sats>\d+) "
    r"rssi=(?P<rssi>-?\d+) snr=(?P<snr>-?\d+(?:\.\d+)?)"
)
TIME_RE = re.compile(r"(?P<t>\d{2}:\d{2}:\d{2}(?:\.\d+)?)")
BANNER_RE = re.compile(r"=== FarmTrack GATEWAY ===")
UPLOAD_FAIL_RE = re.compile(r"upload failed, HTTP (?P<code>-?\d+)")
NO_STATE_RE = re.compile(r"no state to relay back")
BAD_JSON_RE = re.compile(r"bad response JSON")
BROWNOUT_RE = re.compile(r"Brownout detector was triggered", re.IGNORECASE)


def parse_time(s):
    s = s.strip()
    fmt = "%H:%M:%S.%f" if "." in s else "%H:%M:%S"
    return datetime.strptime(s, fmt)


def unwrap_midnight(dt, prev):
    """Log may cross midnight; push forward a day if time went backwards."""
    while prev is not None and dt < prev - timedelta(hours=12):
        dt += timedelta(days=1)
    return dt


def load(path):
    rx, events = [], []
    prev = None
    with open(path, "r", errors="replace") as fh:
        for lineno, line in enumerate(fh, 1):
            m = RX_RE.search(line)
            tm = TIME_RE.match(line.strip())
            ts = None
            if tm:
                ts = unwrap_midnight(parse_time(tm.group("t")), prev)
                prev = ts
            if m:
                rx.append(
                    {
                        "t": ts,
                        "dev": m.group("dev").upper(),
                        "seq": int(m.group("seq")),
                        "fix": int(m.group("fix")),
                        "sats": int(m.group("sats")),
                        "rssi": int(m.group("rssi")),
                        "snr": float(m.group("snr")),
                        "lineno": lineno,
                    }
                )
                continue
            for regex, kind in (
                (BANNER_RE, "GATEWAY REBOOT"),
                (BROWNOUT_RE, "BROWNOUT RESET"),
                (UPLOAD_FAIL_RE, "upload failed"),
                (NO_STATE_RE, "no downlink sent"),
                (BAD_JSON_RE, "bad response JSON"),
            ):
                if regex.search(line):
                    events.append({"t": ts, "kind": kind, "lineno": lineno,
                                   "raw": line.strip()})
                    break
    return rx, events


def stats(vals):
    if not vals:
        return None
    s = {
        "n": len(vals),
        "median": statistics.median(vals),
        "mean": statistics.fmean(vals),
        "min": min(vals),
        "max": max(vals),
        "sd": statistics.stdev(vals) if len(vals) > 1 else float("nan"),
    }
    return s


def fmt(s, unit="", prec=1):
    if s is None:
        return "no data"
    sd = "n/a" if s["sd"] != s["sd"] else f"{s['sd']:.{prec}f}"
    return (
        f"median {s['median']:.{prec}f}{unit}, mean {s['mean']:.{prec}f}{unit}, "
        f"sd {sd}, min {s['min']:.{prec}f}{unit}, max {s['max']:.{prec}f}{unit}"
    )


def window(rx, start, end, device=None):
    out = []
    for r in rx:
        if r["t"] is None:
            continue
        if device and r["dev"] != device.upper():
            continue
        if start <= r["t"].time() <= end:
            out.append(r)
    return out


def pdr(rows):
    """Delivery ratio from the seq span actually observed in this window."""
    if len(rows) < 2:
        return None
    seqs = sorted({r["seq"] for r in rows})
    span = seqs[-1] - seqs[0] + 1
    if span <= 0:
        return None
    return {
        "received": len(seqs),
        "expected": span,
        "lost": span - len(seqs),
        "ratio": len(seqs) / span,
        "seq_first": seqs[0],
        "seq_last": seqs[-1],
        "duplicates": len(rows) - len(seqs),
    }


def report_point(name, label, dist, rows, out):
    out.append(f"### {name} — {label} ({dist} m)")
    out.append("")
    if not rows:
        out.append("**No packets received in this window.** Either the link was "
                   "down for the whole dwell, or the window times are wrong "
                   "(check the phone-to-laptop clock offset recorded in "
                   "notes.md). These are not interchangeable — say which.")
        out.append("")
        return
    d = pdr(rows)
    out.append(f"- packets logged: {len(rows)}")
    if d:
        out.append(
            f"- seq range {d['seq_first']}–{d['seq_last']} "
            f"→ collar sent {d['expected']}, gateway received {d['received']}, "
            f"lost {d['lost']}"
        )
        out.append(f"- **PDR: {100 * d['ratio']:.1f}%** (n={d['expected']} sent)")
        if d["duplicates"]:
            out.append(f"- duplicate seq lines: {d['duplicates']}")
    else:
        out.append("- only one packet: PDR undefined (need >=2 to span a seq range)")
    out.append(f"- **RSSI dBm**: {fmt(stats([r['rssi'] for r in rows]))}")
    out.append(f"- **SNR dB**: {fmt(stats([r['snr'] for r in rows]))}")
    sats = stats([r["sats"] for r in rows])
    fixes = sum(1 for r in rows if r["fix"])
    out.append(f"- sats in view: {fmt(sats, prec=1)}")
    out.append(f"- fix=1 on {fixes}/{len(rows)} packets "
               f"({100 * fixes / len(rows):.0f}%)")
    out.append("")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("log")
    ap.add_argument("--points", help="CSV of measurement windows")
    ap.add_argument("--device", default=None,
                    help="filter to one collar, e.g. EC82C34C")
    args = ap.parse_args()

    rx, events = load(args.log)
    out = []
    out.append(f"# Gateway log analysis — `{args.log.split('/')[-1]}`")
    out.append("")
    out.append(f"Generated by `docs/field-tests/scripts/analyze_gateway_log.py`. "
               f"Radio settings are fixed in firmware and must be quoted with "
               f"these numbers: 433 MHz, SF9, sync word 0xF3, payload CRC on, "
               f"17 dBm default TX power.")
    out.append("")

    if not rx:
        out.append("**No `RX from` lines found.** Nothing to analyse.")
        print("\n".join(out))
        return

    devs = sorted({r["dev"] for r in rx})
    out.append(f"- total RX lines: {len(rx)}")
    out.append(f"- device IDs seen: {', '.join('FT-' + d for d in devs)}")
    if len(devs) > 1:
        out.append("  - More than one device ID. With payload CRC enabled a "
                   "corrupted packet should be dropped by the radio, so an "
                   "unexpected ID here needs explaining before any number in "
                   "this file is trusted.")
    span_t = [r["t"] for r in rx if r["t"]]
    if span_t:
        out.append(f"- log spans {span_t[0].time()} to {span_t[-1].time()} "
                   f"(laptop clock)")
    out.append("")

    reboots = [e for e in events if e["kind"] in ("GATEWAY REBOOT", "BROWNOUT RESET")]
    fails = [e for e in events if e["kind"] == "upload failed"]
    nostate = [e for e in events if e["kind"] == "no downlink sent"]
    out.append("## Gateway health")
    out.append("")
    out.append(f"- reboots / banners in log: {len(reboots)}")
    for e in reboots:
        t = e["t"].time() if e["t"] else "?"
        out.append(f"  - {t} line {e['lineno']}: {e['kind']}")
    out.append(f"- upload failures: {len(fails)}")
    if fails:
        first = fails[0]
        t = first["t"].time() if first["t"] else "?"
        out.append(f"  - first failure at {t} (line {first['lineno']})")
        out.append("  - Every RX line after this point still gives valid "
                   "RSSI/SNR/PDR, but Supabase delivery counts across this "
                   "stretch are measuring the WiFi/TLS path, not the radio.")
    out.append(f"- cycles with no downlink relayed: {len(nostate)}")
    out.append("")
    out.append("Note: when no downlink reaches the collar its send cycle "
               "stretches from ~3s to ~4s (collar.cpp waits the full 4000 ms "
               "reply timeout), so packet counts per minute drop for reasons "
               "unrelated to range. PDR below is seq-based and immune to this.")
    out.append("")

    out.append("## Whole log (all packets)")
    out.append("")
    report_point("ALL", "entire log", "n/a", rx, out)

    if args.points:
        out.append("## Per measurement point")
        out.append("")
        with open(args.points) as fh:
            for row in csv.DictReader(fh):
                if not row.get("point"):
                    continue
                try:
                    s = parse_time(row["start"]).time()
                    e = parse_time(row["end"]).time()
                except (ValueError, KeyError):
                    out.append(f"### {row['point']} — unparseable window, skipped")
                    out.append("")
                    continue
                rows = window(rx, s, e, args.device)
                report_point(row["point"], row.get("label", ""),
                             row.get("dist_m", "?"), rows, out)

        out.append("## Range summary")
        out.append("")
        out.append("| Point | Dist (m) | n sent | PDR % | RSSI median | SNR median |")
        out.append("|---|---|---|---|---|---|")
        with open(args.points) as fh:
            for row in csv.DictReader(fh):
                if not row.get("point"):
                    continue
                try:
                    s = parse_time(row["start"]).time()
                    e = parse_time(row["end"]).time()
                except (ValueError, KeyError):
                    continue
                rows = window(rx, s, e, args.device)
                if not rows:
                    out.append(f"| {row['point']} | {row.get('dist_m','?')} | "
                               f"0 | 0.0 (no packets) | — | — |")
                    continue
                d = pdr(rows)
                rs = statistics.median([r["rssi"] for r in rows])
                sn = statistics.median([r["snr"] for r in rows])
                out.append(
                    f"| {row['point']} | {row.get('dist_m','?')} | "
                    f"{d['expected'] if d else len(rows)} | "
                    f"{100 * d['ratio']:.1f} | {rs:.0f} | {sn:.1f} |"
                )
        out.append("")
        out.append("SF7 baseline for comparison, measured at this site before "
                   "payload CRC was enabled: link worked to about RSSI -91 and "
                   "failed at -96/-98 with SNR -10. Those pre-CRC readings are "
                   "not trustworthy at marginal RSSI, so treat -91 as an "
                   "approximate reference only.")
        out.append("")

    print("\n".join(out))


if __name__ == "__main__":
    sys.exit(main())
