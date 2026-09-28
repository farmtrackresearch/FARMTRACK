#!/usr/bin/env python3
"""
Parse a FarmTrack gateway serial log and report LoRa link quality per
measurement point.

Input format is whatever `pio device monitor -f time -f log2file` writes for
firmware/src/gateway.cpp, i.e. lines like:

    00:41:07.512 > RX from EC82C34C seq=412 fix=1 sats=7 rssi=-84 snr=8.2
    00:41:07.512 > RX from 1A2B3C4D seq=412 fix=1 sats=7 rssi=-84 snr=8.2 gps_ok=1 gps_rst=0
    00:41:09.980 > TX reply state=2
    00:41:09.980 > TX reply state=2 seq=412
    00:41:09.980 > TX reply state=2 seq=412 dev=1A2B3C4D
    00:41:08.301 > upload ok n=1 ms=742 heap=151320 maxblk=110580
    00:41:31.004 > upload failed, HTTP -1:
    00:41:31.007 > no state to relay back - skipping downlink reply this cycle
    00:41:31.007 > no state to relay back - skipping downlink reply this cycle n=3
    00:41:31.007 > no state to relay back - skipping downlink reply this cycle dev=1A2B3C4D
    00:41:35.100 > reply late, skipped seq=413 age=3900ms
    00:41:35.200 > reply queue full - reply dropped
    00:41:36.200 > queue full, dropped oldest seq=300
    00:41:40.000 > ignored packet len=21 ver=1 - collar and gateway must both run protocol v2
    00:41:41.000 > radio re-init: no uplink heard for 5 minutes
    00:41:42.000 > 5 uploads in a row got no answer with WiFi up - restarting (4 queued readings lost)
    00:41:43.000 > 5 uploads in a row got no answer, but the server hasn't answered since boot - not restarting yet (queue kept)
    00:41:44.000 > response truncated at 4096 bytes
    00:41:45.000 > batch of 64 failed 3 times - retrying 32 at a time
    00:41:46.000 > dropped reading dev=1A2B3C4D seq=412 after 3 server errors
    00:41:47.000 > uplink lost: it arrived while reply seq=412 was being sent
    00:41:48.000 > upload task create failed - restarting in 1s
    00:42:02.113 > === FarmTrack GATEWAY ===
    00:42:02.120 > reset reason: BROWNOUT

The first two lines are the same RX line from a protocol v1 and a protocol v2
gateway. Contract v2 froze the v1 prefix and only appends fields at the end, so
both parse with one pattern; `gps_ok`/`gps_rst` are read when present and
reported as "not in this log" when absent. The `upload ok`, `reply late`,
`queue full` and `reset reason` lines exist only in v2 gateway builds.

The gateway prints its RX line when the radio hands it the packet, before any
upload is attempted (v1: gateway.cpp line 154 vs the upload at line 159; v2:
reception and upload are decoupled by a queue), so RSSI/SNR/PDR figures
produced here remain valid even across stretches where uploads were failing.
Only the Supabase delivery numbers depend on the upload path.

Packet delivery ratio is computed from the collar's seq counter, NOT from an
assumed packet interval. collar.cpp increments seq on every transmit, but its
cycle length changes with reply timeouts (and, in v2, deliberate jitter), so
any "expected packets = window / 3s" calculation would be wrong exactly at the
marginal points that matter most.

seq is a uint16 that starts at 0 whenever the collar boots (collar.cpp:
`static uint16_t seqCounter = 0; pkt.seq = seqCounter++;`). So within a
window, for each device, the RX lines are split into monotonic seq segments:

  * seq goes backwards and the forward distance (mod 65536) is consistent with
    the time elapsed  -> uint16 wrap at 65535; same segment, counter unwrapped.
  * seq goes backwards otherwise -> collar reboot; a new segment starts.

    PDR = sum over segments of distinct seq received
          / sum over segments of (last_seq - first_seq + 1)

Packets sent between the last received packet and a reboot cannot be known
and are not counted. A reboot that happens inside a gap long enough for the
new seq to climb past the old one is indistinguishable from packet loss and
is counted as loss (PDR errs low, not high).

Usage:
    python3 analyze_gateway_log.py GATEWAY.log --points points.csv
    python3 analyze_gateway_log.py GATEWAY.log            # whole-log summary only
    python3 analyze_gateway_log.py --selftest             # parser self-test

points.csv (header required; times are laptop clock HH:MM:SS, same clock the
log is stamped with; a window may cross midnight, e.g. start 23:58:00 end
00:03:00):

    point,label,dist_m,start,end
    P0,reference point,0,00:35:00,00:50:00
    P1,first pole past gate,52,00:53:10,00:54:40
"""

import argparse
import csv
import io
import math
import re
import statistics
import sys
from datetime import datetime, timedelta

# 00:41:07.512 > RX from EC82C34C seq=412 fix=1 sats=7 rssi=-84 snr=8.2
# Frozen v1 prefix. Anything after snr (v2: " gps_ok=%d gps_rst=%d") is read
# from the remainder of the line, so fields added later do not break parsing.
RX_RE = re.compile(
    r"(?P<t>\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s*>?\s*"
    r"RX from (?P<dev>[0-9A-Fa-f]{8}) "
    r"seq=(?P<seq>\d+) fix=(?P<fix>\d+) sats=(?P<sats>\d+) "
    r"rssi=(?P<rssi>-?\d+) snr=(?P<snr>-?\d+(?:\.\d+)?)"
)
GPS_OK_RE = re.compile(r"\bgps_ok=(?P<v>\d+)")
GPS_RST_RE = re.compile(r"\bgps_rst=(?P<v>\d+)")
TIME_RE = re.compile(r"(?P<t>\d{2}:\d{2}:\d{2}(?:\.\d+)?)")
BANNER_RE = re.compile(r"=== FarmTrack GATEWAY ===")
UPLOAD_FAIL_RE = re.compile(r"upload failed, HTTP (?P<code>-?\d+)")
UPLOAD_OK_RE = re.compile(
    r"upload ok n=(?P<n>\d+) ms=(?P<ms>\d+) heap=(?P<heap>\d+) "
    r"maxblk=(?P<maxblk>\d+)"
)
# "no state to relay back - skipping downlink reply this cycle" has three forms
# (strings as in firmware/src/gateway.cpp v2, md5 b237b5e3...):
#   (plain)       v1: once per reading. v2: once per batch after "bad response
#                 JSON" (line 168); n is then taken from that batch's
#                 "upload ok n=" line.
#   " n=<count>"  v2: once per FAILED batch of <count> readings (line 231).
#   " dev=<id>"   v2: once per device that got no state in an answered batch
#                 (line 198); counted as 1 although it may cover several of
#                 that device's readings, so the total is a lower bound.
NO_STATE_RE = re.compile(r"no state to relay back")
NO_STATE_N_RE = re.compile(r"\bn=(?P<n>\d+)")
DEV_RE = re.compile(r"\bdev=(?P<dev>[0-9A-Fa-f]{8})")
BAD_JSON_RE = re.compile(r"bad response JSON")
BROWNOUT_RE = re.compile(r"Brownout detector was triggered", re.IGNORECASE)
# v2: "TX reply state=%d seq=%u", optionally followed by " dev=%08X".
TX_REPLY_RE = re.compile(r"TX reply state=(?P<state>-?\d+)(?:\s+seq=(?P<seq>\d+))?")
REPLY_LATE_RE = re.compile(
    r"reply late, skipped seq=(?P<seq>\d+) age=(?P<age>\d+)\s*ms")
QUEUE_FULL_RE = re.compile(r"queue full, dropped oldest seq=(?P<seq>\d+)")
REPLY_QFULL_RE = re.compile(r"reply queue full - reply dropped")
RESET_REASON_RE = re.compile(r"reset reason:\s*(?P<reason>\S.*?)\s*$")
# v2 gateway drops packets of the wrong size or protocol version, logging this
# at most once every 30 s - so the count is of log lines, not of packets.
IGNORED_RE = re.compile(r"ignored packet len=(?P<len>-?\d+) ver=(?P<ver>-?\d+)")
RADIO_REINIT_RE = re.compile(r"radio re-init:\s*(?P<why>\S.*?)\s*$")
UPLOAD_RESTART_RE = re.compile(
    r"(?P<k>\d+) uploads in a row got no answer with WiFi up - restarting "
    r"\((?P<lost>\d+) queued readings lost\)")
# Reliability pass (gateway.cpp md5 98d30555...). A failed batch is KEPT and
# retried; after SERVER_ERRORS_BEFORE_SPLIT server errors it is halved, and a
# single reading that still fails is dropped. HTTP 4xx (not 408/429) drops the
# whole batch without a retry.
RESTART_DEFERRED_RE = re.compile(
    r"(?P<k>\d+) uploads in a row got no answer, but the server hasn't "
    r"answered since boot - not restarting yet \(queue kept\)")
TRUNCATED_RE = re.compile(r"response truncated at (?P<bytes>\d+) bytes")
BATCH_SPLIT_RE = re.compile(
    r"batch of (?P<size>\d+) failed (?P<times>\d+) times - retrying "
    r"(?P<limit>\d+) at a time")
DROPPED_READING_RE = re.compile(
    r"dropped reading dev=(?P<dev>[0-9A-Fa-f]{8}) seq=(?P<seq>\d+) after "
    r"(?P<errs>\d+) server errors")
# The reply transmit overwrote an uplink that had just arrived; the gateway
# discards it. seq here is the REPLY's seq, not the lost uplink's.
UPLINK_LOST_RE = re.compile(
    r"uplink lost: it arrived while reply seq=(?P<seq>\d+) was being sent")
# Lines printed just before the gateway calls ESP.restart() itself.
SELF_RESTART_RE = re.compile(
    r"(?P<why>upload task create failed - restarting in 1s"
    r"|out of memory creating queues - restarting"
    r"|LoRa FAILED - .*restarting in 5s)")

SEQ_MOD = 65536          # seq is uint16_t in packet.h
# Fastest plausible collar cycle. v2 sends every 3000 ms +/-10% jitter (>=2.7 s),
# v1 every >=3000 ms. 2.0 s leaves margin. Used only to tell a uint16 wrap
# (small forward step through 65535->0) from a reboot (seq restarts at 0).
MIN_CYCLE_S = 2.0
# Fallback wrap test when the log has no timestamps (monitor run without -f time).
WRAP_EDGE = 512

STATE_NAMES = {0: "SAFE", 1: "WARNING", 2: "BREACH"}

V2_KINDS = ("upload ok", "reply late", "queue full", "reset reason",
            "reply queue full", "ignored packet", "radio re-init",
            "upload restart", "restart deferred", "response truncated",
            "batch split", "dropped reading", "uplink lost", "self restart")


def parse_time(s):
    s = s.strip()
    fmt = "%H:%M:%S.%f" if "." in s else "%H:%M:%S"
    return datetime.strptime(s, fmt)


def unwrap_midnight(dt, prev):
    """Log may cross midnight; push forward a day if time went backwards."""
    while prev is not None and dt < prev - timedelta(hours=12):
        dt += timedelta(days=1)
    return dt


def norm_dev(d):
    """Accept 'FT-1A2B3C4D', 'ft-1a2b3c4d' or '1A2B3C4D'."""
    if d is None:
        return None
    d = d.strip().upper()
    return d[3:] if d.startswith("FT-") else d


def load_lines(lines):
    """Parse an iterable of log lines. Returns a dict with rx, events, span."""
    rx, events = [], []
    prev = None
    first_ts = last_ts = None
    last_rx_idx = None          # v1 pairing: TX reply follows its own RX line
    rx_idx_by_seq = {}          # v2 pairing: TX reply echoes the uplink seq
    rx_idx_by_devseq = {}       # v2 pairing when TX reply also carries dev=
    last_ok_n = None            # batch size from the latest "upload ok n="
    last_fail_code = None       # HTTP code of the "upload failed" before n=
    for lineno, line in enumerate(lines, 1):
        m = RX_RE.search(line)
        tm = TIME_RE.match(line.strip())
        ts = None
        if tm:
            try:
                ts = unwrap_midnight(parse_time(tm.group("t")), prev)
            except ValueError:
                ts = None
            if ts is not None:
                prev = ts
                if first_ts is None:
                    first_ts = ts
                last_ts = ts
        if m:
            tail = line[m.end():]
            ok = GPS_OK_RE.search(tail)
            rst = GPS_RST_RE.search(tail)
            row = {
                "t": ts,
                "dev": m.group("dev").upper(),
                "seq": int(m.group("seq")),
                "fix": int(m.group("fix")),
                "sats": int(m.group("sats")),
                "rssi": int(m.group("rssi")),
                "snr": float(m.group("snr")),
                "gps_ok": int(ok.group("v")) if ok else None,
                "gps_rst": int(rst.group("v")) if rst else None,
                "lineno": lineno,
            }
            last_rx_idx = len(rx)
            rx_idx_by_seq[row["seq"]] = len(rx)
            rx_idx_by_devseq[(row["dev"], row["seq"])] = len(rx)
            rx.append(row)
            continue
        for regex, kind in (
            (BANNER_RE, "GATEWAY REBOOT"),
            (BROWNOUT_RE, "BROWNOUT RESET"),
            (UPLOAD_FAIL_RE, "upload failed"),
            (NO_STATE_RE, "no downlink sent"),
            (BAD_JSON_RE, "bad response JSON"),
            (UPLOAD_OK_RE, "upload ok"),
            (TX_REPLY_RE, "TX reply"),
            (REPLY_LATE_RE, "reply late"),
            (QUEUE_FULL_RE, "queue full"),
            (REPLY_QFULL_RE, "reply queue full"),
            (RESET_REASON_RE, "reset reason"),
            (IGNORED_RE, "ignored packet"),
            (RADIO_REINIT_RE, "radio re-init"),
            (UPLOAD_RESTART_RE, "upload restart"),
            (RESTART_DEFERRED_RE, "restart deferred"),
            (TRUNCATED_RE, "response truncated"),
            (BATCH_SPLIT_RE, "batch split"),
            (DROPPED_READING_RE, "dropped reading"),
            (UPLINK_LOST_RE, "uplink lost"),
            (SELF_RESTART_RE, "self restart"),
        ):
            em = regex.search(line)
            if not em:
                continue
            ev = {"t": ts, "kind": kind, "lineno": lineno, "raw": line.strip()}
            tail = line[em.end():]
            if kind == "upload ok":
                ev.update({k: int(em.group(k)) for k in ("n", "ms", "heap", "maxblk")})
                last_ok_n = ev["n"]
            elif kind == "upload failed":
                last_ok_n = None
                last_fail_code = int(em.group("code"))
            elif kind == "no downlink sent":
                nm, dm = NO_STATE_N_RE.search(tail), DEV_RE.search(tail)
                if nm:
                    ev["n"], ev["form"] = int(nm.group("n")), "failed batch"
                    ev["http"] = last_fail_code
                    last_fail_code = None
                elif dm:
                    ev["n"], ev["form"] = 1, "device without state"
                    ev["dev"] = dm.group("dev").upper()
                elif (events and events[-1]["kind"] == "bad response JSON"
                      and last_ok_n is not None):
                    ev["n"], ev["form"] = last_ok_n, "bad-JSON batch"
                else:
                    ev["n"], ev["form"] = 1, "plain"
            elif kind == "TX reply":
                ev["state"] = int(em.group("state"))
                dm = DEV_RE.search(tail)
                ev["dev"] = dm.group("dev").upper() if dm else None
                if em.group("seq") is not None:
                    ev["seq"] = int(em.group("seq"))
                    if ev["dev"]:
                        ev["rx_idx"] = rx_idx_by_devseq.get((ev["dev"], ev["seq"]))
                        ev["paired_by"] = "dev+seq"
                    else:
                        ev["rx_idx"] = rx_idx_by_seq.get(ev["seq"])
                        ev["paired_by"] = "seq"
                else:
                    ev["seq"] = None
                    ev["rx_idx"] = last_rx_idx
                    ev["paired_by"] = "previous RX line"
            elif kind == "ignored packet":
                ev["len"], ev["ver"] = int(em.group("len")), int(em.group("ver"))
            elif kind == "radio re-init":
                ev["why"] = em.group("why")
            elif kind == "upload restart":
                ev["lost"] = int(em.group("lost"))
            elif kind == "restart deferred":
                ev["k"] = int(em.group("k"))
            elif kind == "response truncated":
                ev["bytes"] = int(em.group("bytes"))
            elif kind == "batch split":
                ev.update({k: int(em.group(k)) for k in ("size", "times", "limit")})
            elif kind == "dropped reading":
                ev["dev"] = em.group("dev").upper()
                ev["seq"] = int(em.group("seq"))
                ev["errs"] = int(em.group("errs"))
            elif kind == "uplink lost":
                ev["seq"] = int(em.group("seq"))
            elif kind == "self restart":
                ev["why"] = em.group("why")
            elif kind == "reply late":
                ev["seq"] = int(em.group("seq"))
                ev["age_ms"] = int(em.group("age"))
            elif kind == "queue full":
                ev["seq"] = int(em.group("seq"))
            elif kind == "reset reason":
                ev["reason"] = em.group("reason")
            events.append(ev)
            break
    span = (first_ts, last_ts) if first_ts is not None else None
    return {"rx": rx, "events": events, "span": span}


def load(path):
    with open(path, "r", errors="replace") as fh:
        return load_lines(fh)


def percentile(vals, p):
    """Linear interpolation between closest ranks; same as PostgreSQL
    percentile_cont and numpy's default, so SQL and Python figures agree."""
    xs = sorted(vals)
    if not xs:
        return None
    pos = p * (len(xs) - 1)
    lo, hi = math.floor(pos), math.ceil(pos)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


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
        "p95": percentile(vals, 0.95),
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


def fmt_p95(s, unit="", prec=0):
    if s is None:
        return "no data"
    sd = "n/a" if s["sd"] != s["sd"] else f"{s['sd']:.{prec}f}"
    return (
        f"n {s['n']}, median {s['median']:.{prec}f}{unit}, "
        f"mean {s['mean']:.{prec}f}{unit}, sd {sd}, "
        f"p95 {s['p95']:.{prec}f}{unit}, min {s['min']:.{prec}f}{unit}, "
        f"max {s['max']:.{prec}f}{unit}"
    )


def tstr(t):
    return t.time() if t is not None else "?"


# --- measurement windows ------------------------------------------------------

def resolve_window(start_t, end_t, span):
    """Place a time-of-day window on the log's midnight-unwrapped timeline.

    A window with start > end (e.g. 23:58-00:03) crosses midnight. Returns
    (window_start_dt, window_end_dt, ambiguous) or None when the window does
    not overlap the log at all. `ambiguous` is True only for logs longer than
    a day, where the same time of day occurs twice; the first occurrence is
    used.
    """
    if span is None:
        return None
    first, last = span
    day0 = first.date()
    dur = datetime.combine(day0, end_t) - datetime.combine(day0, start_t)
    if dur < timedelta(0):
        dur += timedelta(days=1)
    cands = []
    for k in range(-1, (last.date() - day0).days + 2):
        ws = datetime.combine(day0 + timedelta(days=k), start_t)
        we = ws + dur
        if ws <= last and we >= first:
            cands.append((ws, we))
    if not cands:
        return None
    return cands[0][0], cands[0][1], len(cands) > 1


def select_window(log, start_t, end_t, device=None):
    """Rows inside [start, end] (inclusive). Returns (rows, status) with
    status one of 'ok', 'ambiguous', 'outside', 'no-timestamps'."""
    if log["span"] is None:
        return [], "no-timestamps"
    w = resolve_window(start_t, end_t, log["span"])
    if w is None:
        return [], "outside"
    ws, we, ambiguous = w
    dev = norm_dev(device)
    rows = [r for r in log["rx"]
            if r["t"] is not None and ws <= r["t"] <= we
            and (not dev or r["dev"] == dev)]
    return rows, ("ambiguous" if ambiguous else "ok")


# --- packet delivery ratio ----------------------------------------------------

def classify_backstep(prev, cur):
    """cur['seq'] < prev['seq'] for the same device: 'wrap' or 'reboot'."""
    d = (cur["seq"] - prev["seq"]) % SEQ_MOD
    if prev["t"] is not None and cur["t"] is not None:
        elapsed = (cur["t"] - prev["t"]).total_seconds()
        if elapsed >= 0:
            return "wrap" if d <= elapsed / MIN_CYCLE_S + 2 else "reboot"
    if prev["seq"] >= SEQ_MOD - WRAP_EDGE and cur["seq"] < WRAP_EDGE:
        return "wrap"
    return "reboot"


def segment_rows(rows):
    """Split rows (log order) into monotonic seq segments, per device."""
    by_dev = {}
    for r in rows:
        by_dev.setdefault(r["dev"], []).append(r)
    segs, reboots, wraps = [], [], []
    for dev in sorted(by_dev):
        cur, prev, offset = None, None, 0
        for r in by_dev[dev]:
            if prev is None:
                cur = {"dev": dev, "useqs": set(), "rows": 0, "first": r,
                       "after_reboot": False, "wraps": 0}
            elif r["seq"] < prev["seq"]:
                if classify_backstep(prev, r) == "wrap":
                    offset += SEQ_MOD
                    cur["wraps"] += 1
                    wraps.append({"dev": dev, "t": r["t"], "lineno": r["lineno"],
                                  "from": prev["seq"], "to": r["seq"]})
                else:
                    reboots.append({"dev": dev, "t": r["t"], "lineno": r["lineno"],
                                    "from": prev["seq"], "to": r["seq"]})
                    segs.append(cur)
                    cur = {"dev": dev, "useqs": set(), "rows": 0, "first": r,
                           "after_reboot": True, "wraps": 0}
                    offset = 0
            cur["useqs"].add(r["seq"] + offset)
            cur["rows"] += 1
            prev = r
        segs.append(cur)
    for s in segs:
        lo, hi = min(s["useqs"]), max(s["useqs"])
        s["expected"] = hi - lo + 1
        s["received"] = len(s["useqs"])
        s["duplicates"] = s["rows"] - s["received"]
        s["seq_first"] = lo % SEQ_MOD
        s["seq_last"] = hi % SEQ_MOD
    return segs, reboots, wraps


def pdr(rows):
    """Delivery ratio from the seq spans actually observed in this window,
    summed over monotonic segments (collar reboots, uint16 wrap)."""
    if len(rows) < 2:
        return None
    segs, reboots, wraps = segment_rows(rows)
    expected = sum(s["expected"] for s in segs)
    received = sum(s["received"] for s in segs)
    if expected <= 0:
        return None
    return {
        "received": received,
        "expected": expected,
        "lost": expected - received,
        "ratio": received / expected,
        "seq_first": segs[0]["seq_first"],
        "seq_last": segs[0]["seq_last"],
        "duplicates": sum(s["duplicates"] for s in segs),
        "segments": segs,
        "reboots": reboots,
        "wraps": wraps,
    }


# --- report -------------------------------------------------------------------

def report_point(name, label, dist, rows, out, status="ok"):
    out.append(f"### {name} — {label} ({dist} m)")
    out.append("")
    if status == "no-timestamps":
        out.append("**This log has no timestamps**, so no window can be "
                   "matched. Re-run the monitor with `-f time`.")
        out.append("")
        return
    if status == "outside":
        out.append("**This window lies entirely outside the time span of the "
                   "log.** The window times are wrong or the log is "
                   "incomplete; this says nothing about the link. Check the "
                   "phone-to-laptop clock offset recorded in notes.md.")
        out.append("")
        return
    if status == "ambiguous":
        out.append("- WARNING: the log is longer than a day, so this time of "
                   "day occurs more than once; the first occurrence was used.")
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
        segs = d["segments"]
        if len(segs) == 1:
            wrapped = " (wrapped past 65535)" if d["wraps"] else ""
            out.append(
                f"- seq range {d['seq_first']}–{d['seq_last']}{wrapped} "
                f"→ collar sent {d['expected']}, gateway received {d['received']}, "
                f"lost {d['lost']}"
            )
        else:
            out.append(f"- seq splits into {len(segs)} monotonic segments "
                       f"(collar reboots and/or devices); counted per segment, "
                       f"then summed:")
            for s in segs:
                wrapped = " (wrapped past 65535)" if s["wraps"] else ""
                out.append(
                    f"  - FT-{s['dev']} from {tstr(s['first']['t'])} "
                    f"(line {s['first']['lineno']}): seq {s['seq_first']}–"
                    f"{s['seq_last']}{wrapped} → sent {s['expected']}, "
                    f"received {s['received']}, lost "
                    f"{s['expected'] - s['received']}"
                )
            out.append(
                f"- total → collar sent {d['expected']}, gateway received "
                f"{d['received']}, lost {d['lost']}"
            )
        out.append(f"- **PDR: {100 * d['ratio']:.1f}%** (n={d['expected']} sent)")
        if d["duplicates"]:
            out.append(f"- duplicate seq lines: {d['duplicates']}")
        out.append(f"- collar reboots seen (seq restarted): {len(d['reboots'])}")
        for rb in d["reboots"]:
            out.append(f"  - {tstr(rb['t'])} line {rb['lineno']}: "
                       f"FT-{rb['dev']} seq {rb['from']} → {rb['to']}")
        if d["wraps"]:
            out.append(f"- seq wrapped past 65535: {len(d['wraps'])} "
                       f"time(s), counted as one continuous counter")
        for s in segs:
            if s["after_reboot"] and s["seq_first"] > 0:
                out.append(
                    f"- note: after the reboot at line {s['first']['lineno']} "
                    f"the first seq received was {s['seq_first']}, not 0. "
                    f"Those {s['seq_first']} earlier packets were sent but are "
                    f"NOT counted above (PDR spans received seqs only).")
    else:
        out.append("- only one packet: PDR undefined (need >=2 to span a seq range)")
    out.append(f"- **RSSI dBm**: {fmt(stats([r['rssi'] for r in rows]))}")
    out.append(f"- **SNR dB**: {fmt(stats([r['snr'] for r in rows]))}")
    sats = stats([r["sats"] for r in rows])
    fixes = sum(1 for r in rows if r["fix"])
    out.append(f"- sats used in fix (GGA, flags bits 1-5): {fmt(sats, prec=1)}")
    out.append(f"- fix=1 on {fixes}/{len(rows)} packets "
               f"({100 * fixes / len(rows):.0f}%)")
    with_ok = [r for r in rows if r["gps_ok"] is not None]
    if not with_ok:
        out.append("- gps_ok / gps_rst: not in this log (gateway firmware "
                   "older than protocol v2)")
    else:
        k = sum(1 for r in with_ok if r["gps_ok"] == 1)
        missing = len(rows) - len(with_ok)
        extra = (f"; {missing} older-format RX lines had no gps_ok field"
                 if missing else "")
        out.append(f"- GPS NMEA arriving (gps_ok=1): {k}/{len(with_ok)} "
                   f"packets ({100 * k / len(with_ok):.0f}%){extra}")
        rst = sum(1 for r in rows if r["gps_rst"] == 1)
        out.append(f"- GPS module restart flagged (gps_rst=1): {rst} packet(s) "
                   f"(a lower bound: a restart flagged in a lost packet is "
                   f"not seen)")
    out.append("")


def report_health(log, out):
    events = log["events"]
    rx = log["rx"]
    reboots = [e for e in events if e["kind"] in ("GATEWAY REBOOT", "BROWNOUT RESET")]
    fails = [e for e in events if e["kind"] == "upload failed"]
    nostate = [e for e in events if e["kind"] == "no downlink sent"]
    out.append("## Gateway health")
    out.append("")
    out.append(f"- reboots / banners in log: {len(reboots)}")
    for e in reboots:
        out.append(f"  - {tstr(e['t'])} line {e['lineno']}: {e['kind']}")
    out.append(f"- upload failures: {len(fails)}")
    if fails:
        first = fails[0]
        out.append(f"  - first failure at {tstr(first['t'])} (line {first['lineno']})")
        out.append("  - Every RX line after this point still gives valid "
                   "RSSI/SNR/PDR, but Supabase delivery counts across this "
                   "stretch are measuring the WiFi/TLS path, not the radio.")
    is_v2 = (any(e["kind"] in V2_KINDS for e in events)
             or any(r["gps_ok"] is not None for r in rx)
             or any(e["kind"] == "no downlink sent" and e["form"] != "plain"
                    for e in events)
             or any(e["kind"] == "TX reply" and e["seq"] is not None
                    for e in events))
    out.append(f"- readings with no server state (no downlink relayed): "
               f"{sum(e['n'] for e in nostate)}")
    if any(e["form"] != "plain" for e in nostate):
        labels = (
            ("failed batch",
             "in failed batches (`n=` lines; a v2 gateway keeps a failed "
             "batch and retries it, so a reading is counted once per failed "
             "attempt — this is not a count of readings lost)"),
            ("bad-JSON batch", "in batches whose response JSON was unreadable"),
            ("device without state",
             "devices left without a state in an answered batch (`dev=` "
             "lines; 1 each, though each may cover several readings, so the "
             "total above is a lower bound)"),
            ("plain", "from lines without a count (1 each)"),
        )
        for form, label in labels:
            sel = [e for e in nostate if e["form"] == form]
            if sel:
                out.append(f"  - {sum(e['n'] for e in sel)} {label}, "
                           f"{len(sel)} line(s)")
    if is_v2:
        dropped = [e for e in events if e["kind"] == "dropped reading"]
        out.append(f"- readings dropped by the gateway after repeated server "
                   f"errors (never stored): {len(dropped)}")
        per_dev = {}
        for e in dropped:
            per_dev.setdefault(e["dev"], []).append(e["seq"])
        for dev in sorted(per_dev):
            seqs = per_dev[dev]
            out.append(f"  - FT-{dev}: {len(seqs)} (seq "
                       f"{', '.join(map(str, seqs))})")
        rejected = [e for e in nostate if e["form"] == "failed batch"
                    and e.get("http") is not None
                    and 400 <= e["http"] < 500 and e["http"] not in (408, 429)]
        out.append(f"- readings rejected by the server (HTTP 4xx, batch "
                   f"dropped without retry; never stored): "
                   f"{sum(e['n'] for e in rejected)}"
                   + (f" in {len(rejected)} batch(es), HTTP "
                      f"{', '.join(sorted({str(e['http']) for e in rejected}))}"
                      if rejected else ""))

    if not is_v2:
        out.append("- v2 gateway lines (upload ok, reply late, queue full, "
                   "reset reason): none in this log — the gateway firmware "
                   "predates protocol v2, so upload latency and heap were not "
                   "logged")
    else:
        ups = [e for e in events if e["kind"] == "upload ok"]
        out.append(f"- successful uploads: {len(ups)} request(s) carrying "
                   f"{sum(e['n'] for e in ups)} reading(s)")
        if ups:
            out.append(f"  - upload round trip (ms): "
                       f"{fmt_p95(stats([e['ms'] for e in ups]))}")
            heaps = [e["heap"] for e in ups]
            blks = [e["maxblk"] for e in ups]
            out.append(f"  - free heap after upload (bytes): min {min(heaps)}, "
                       f"first {heaps[0]}, last {heaps[-1]}")
            out.append(f"  - largest free block, maxblk (bytes): min {min(blks)}, "
                       f"first {blks[0]}, last {blks[-1]} — a steady fall "
                       f"across the run means heap fragmentation")
        late = [e for e in events if e["kind"] == "reply late"]
        line = f"- replies skipped as too late for the collar: {len(late)}"
        if late:
            ages = [e["age_ms"] for e in late]
            line += (f" (age ms: median {statistics.median(ages):.0f}, "
                     f"max {max(ages)})")
        out.append(line)
        rqfull = [e for e in events if e["kind"] == "reply queue full"]
        out.append(f"- replies dropped because the reply queue was full: "
                   f"{len(rqfull)}")
        qfull = [e for e in events if e["kind"] == "queue full"]
        out.append(f"- uplinks dropped because the upload queue was full: "
                   f"{len(qfull)} (received by radio, never uploaded)")
        lost = [e for e in events if e["kind"] == "uplink lost"]
        out.append(f"- uplinks lost because a reply was being transmitted "
                   f"(radio side): {len(lost)}. The gateway received these "
                   f"but discarded them, so they print no RX line and count "
                   f"as lost in PDR; the logged seq is the reply's, so they "
                   f"cannot be attributed to a device")
        splits = [e for e in events if e["kind"] == "batch split"]
        line = f"- batch splits after repeated server errors: {len(splits)}"
        if splits:
            line += (" (" + ", ".join(f"{e['size']}→{e['limit']}"
                                      for e in splits) + ")")
        out.append(line)
        trunc = [e for e in events if e["kind"] == "response truncated"]
        line = f"- server responses truncated: {len(trunc)}"
        if trunc:
            line += (f" (at {', '.join(sorted({str(e['bytes']) for e in trunc}))}"
                     f" bytes)")
        out.append(line)
        restarts = [e for e in events if e["kind"] == "upload restart"]
        out.append(f"- restarts after repeated unanswered uploads: "
                   f"{len(restarts)} ({sum(e['lost'] for e in restarts)} "
                   f"queued readings lost)")
        deferred = [e for e in events if e["kind"] == "restart deferred"]
        out.append(f"- restarts deferred because the server had not answered "
                   f"since boot (queue kept): {len(deferred)}")
        selfr = [e for e in events if e["kind"] == "self restart"]
        out.append(f"- other self-restarts announced by the gateway: "
                   f"{len(selfr)}")
        for e in selfr:
            out.append(f"  - {tstr(e['t'])} line {e['lineno']}: {e['why']}")
        reinits = [e for e in events if e["kind"] == "radio re-init"]
        out.append(f"- radio re-inits: {len(reinits)}")
        for e in reinits:
            out.append(f"  - {tstr(e['t'])} line {e['lineno']}: {e['why']}")
        ignored = [e for e in events if e["kind"] == "ignored packet"]
        vers = sorted({e["ver"] for e in ignored})
        out.append(f"- `ignored packet` lines (wrong size or protocol version; "
                   f"logged at most every 30 s, so not a packet count): "
                   f"{len(ignored)}"
                   + (f", versions seen: {', '.join(map(str, vers))}"
                      if ignored else ""))
        reasons = [e for e in events if e["kind"] == "reset reason"]
        out.append(f"- gateway reset reasons logged: {len(reasons)}")
        for e in reasons:
            out.append(f"  - {tstr(e['t'])} line {e['lineno']}: {e['reason']}")

    tx = [e for e in events if e["kind"] == "TX reply"]
    if tx:
        counts = {}
        for e in tx:
            counts[e["state"]] = counts.get(e["state"], 0) + 1
        parts = ", ".join(f"{STATE_NAMES.get(s, s)} {n}"
                          for s, n in sorted(counts.items()))
        out.append(f"- downlink replies sent (TX reply): {len(tx)} — {parts}")
        paired = [e for e in tx if e["rx_idx"] is not None]
        bad = [e for e in paired
               if e["state"] != 0 and rx[e["rx_idx"]]["fix"] == 0]
        methods = sorted({e["paired_by"] for e in paired})
        out.append(f"  - non-SAFE replies to an uplink with fix=0: {len(bad)} "
                   f"of {len(paired)} replies matched to their uplink "
                   f"(matched by {' / '.join(methods) or 'n/a'}). Contract v2 "
                   f"requires 0: the server returns SAFE when there is no fix.")
    out.append("")
    out.append("Note: when no downlink reaches the collar its send cycle "
               "stretches from ~3s to ~4s (collar.cpp waits the full 4000 ms "
               "reply timeout), so packet counts per minute drop for reasons "
               "unrelated to range. PDR below is seq-based and immune to this.")
    out.append("")


def read_points(path):
    pts = []
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh):
            if not row.get("point"):
                continue
            try:
                s = parse_time(row["start"]).time()
                e = parse_time(row["end"]).time()
            except (ValueError, KeyError, TypeError, AttributeError):
                s = e = None
            pts.append({"row": row, "start": s, "end": e})
    return pts


def build_report(log, points=None, device=None, logname="log"):
    rx = log["rx"]
    out = []
    out.append(f"# Gateway log analysis — `{logname}`")
    out.append("")
    out.append(f"Generated by `docs/field-tests/scripts/analyze_gateway_log.py`. "
               f"Radio settings are fixed in firmware and must be quoted with "
               f"these numbers: 433 MHz, SF9, sync word 0xF3, payload CRC on, "
               f"17 dBm default TX power.")
    out.append("")

    if not rx:
        out.append("**No `RX from` lines found.** Nothing to analyse.")
        ignored = [e for e in log["events"] if e["kind"] == "ignored packet"]
        if ignored:
            vers = sorted({e["ver"] for e in ignored})
            out.append("")
            out.append(f"But the gateway logged {len(ignored)} `ignored packet` "
                       f"line(s) (protocol versions seen: "
                       f"{', '.join(map(str, vers))}). The radio link is up; "
                       f"the collar and gateway run different protocol "
                       f"versions. Reflash both from the same tree.")
        return out

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
        cross = (" — crosses midnight"
                 if span_t[-1].date() != span_t[0].date() else "")
        out.append(f"- log spans {span_t[0].time()} to {span_t[-1].time()} "
                   f"(laptop clock){cross}")
    out.append("")

    report_health(log, out)

    out.append("## Whole log (all packets)")
    out.append("")
    report_point("ALL", "entire log", "n/a", rx, out)

    if points is not None:
        out.append("## Per measurement point")
        out.append("")
        results = []
        for p in points:
            row = p["row"]
            if p["start"] is None:
                out.append(f"### {row['point']} — unparseable window, skipped")
                out.append("")
                continue
            rows, status = select_window(log, p["start"], p["end"], device)
            report_point(row["point"], row.get("label", ""),
                         row.get("dist_m", "?"), rows, out, status)
            results.append((row, rows, status))

        out.append("## Range summary")
        out.append("")
        out.append("| Point | Dist (m) | n sent | PDR % | RSSI median | SNR median "
                   "| Collar reboots |")
        out.append("|---|---|---|---|---|---|---|")
        for row, rows, status in results:
            dist = row.get("dist_m", "?")
            if status in ("outside", "no-timestamps"):
                out.append(f"| {row['point']} | {dist} | — | window not in log "
                           f"| — | — | — |")
                continue
            if not rows:
                out.append(f"| {row['point']} | {dist} | "
                           f"0 | 0.0 (no packets) | — | — | — |")
                continue
            d = pdr(rows)
            rs = statistics.median([r["rssi"] for r in rows])
            sn = statistics.median([r["snr"] for r in rows])
            if d:
                out.append(
                    f"| {row['point']} | {dist} | {d['expected']} | "
                    f"{100 * d['ratio']:.1f} | {rs:.0f} | {sn:.1f} | "
                    f"{len(d['reboots'])} |"
                )
            else:
                out.append(
                    f"| {row['point']} | {dist} | {len(rows)} | "
                    f"n/a (1 packet) | {rs:.0f} | {sn:.1f} | — |"
                )
        out.append("")
        out.append("SF7 baseline for comparison, measured at this site before "
                   "payload CRC was enabled: link worked to about RSSI -91 and "
                   "failed at -96/-98 with SNR -10. Those pre-CRC readings are "
                   "not trustworthy at marginal RSSI, so treat -91 as an "
                   "approximate reference only.")
        out.append("")
    return out


# --- self-test ----------------------------------------------------------------

# Synthetic gateway log: v1 lines, then v2 lines after midnight, a collar
# (AAAA0001) reboot, a uint16 wrap on a second collar (BBBB0002), and a
# brownout. Every expected number below is worked out by hand in comments.
SELFTEST_LOG = """\
23:59:40.000 > === FarmTrack GATEWAY ===
23:59:41.000 > RX from AAAA0001 seq=10 fix=0 sats=0 rssi=-60 snr=9.0
23:59:43.000 > TX reply state=2
23:59:44.000 > RX from AAAA0001 seq=11 fix=1 sats=7 rssi=-61 snr=8.5
23:59:45.000 > upload failed, HTTP -1:
23:59:45.001 > no state to relay back - skipping downlink reply this cycle
23:59:50.000 > RX from AAAA0001 seq=13 fix=1 sats=7 rssi=-62 snr=8.0
23:59:52.000 > TX reply state=1
00:00:02.000 > RX from AAAA0001 seq=14 fix=1 sats=8 rssi=-63 snr=7.5 gps_ok=1 gps_rst=0
00:00:02.400 > upload ok n=1 ms=380 heap=150000 maxblk=110000
00:00:02.500 > TX reply state=0 seq=14
00:00:05.000 > RX from AAAA0001 seq=15 fix=0 sats=3 rssi=-64 snr=7.0 gps_ok=1 gps_rst=1
00:00:05.600 > upload ok n=1 ms=600 heap=149000 maxblk=100000
00:00:05.700 > TX reply state=0 seq=15
00:00:06.000 > RX from BBBB0002 seq=65530 fix=0 sats=0 rssi=-90 snr=-5.0 gps_ok=0 gps_rst=0
00:00:08.000 > RX from AAAA0001 seq=15 fix=0 sats=3 rssi=-64 snr=7.0 gps_ok=1 gps_rst=0
00:00:08.100 > reply late, skipped seq=15 age=3900ms
00:00:09.000 > RX from BBBB0002 seq=65531 fix=0 sats=0 rssi=-91 snr=-5.5 gps_ok=0 gps_rst=0
00:00:20.000 > RX from AAAA0001 seq=0 fix=0 sats=0 rssi=-65 snr=6.0 gps_ok=0 gps_rst=0
00:00:23.000 > RX from AAAA0001 seq=1 fix=0 sats=0 rssi=-65 snr=6.0 gps_ok=0 gps_rst=0
00:00:26.000 > RX from AAAA0001 seq=3 fix=0 sats=0 rssi=-66 snr=5.5 gps_ok=1 gps_rst=0
00:00:26.100 > queue full, dropped oldest seq=1
00:00:26.500 > upload ok n=3 ms=1200 heap=148000 maxblk=90000
00:00:26.600 > TX reply state=2 seq=3
00:00:30.000 > RX from BBBB0002 seq=65534 fix=0 sats=0 rssi=-92 snr=-6.0 gps_ok=0 gps_rst=0
00:00:33.000 > RX from BBBB0002 seq=65535 fix=0 sats=0 rssi=-92 snr=-6.0 gps_ok=0 gps_rst=0
00:00:36.000 > RX from BBBB0002 seq=0 fix=0 sats=0 rssi=-93 snr=-6.5 gps_ok=0 gps_rst=0
00:00:39.000 > RX from BBBB0002 seq=2 fix=0 sats=0 rssi=-93 snr=-7.0 gps_ok=0 gps_rst=0
00:00:40.000 > Brownout detector was triggered
00:00:41.000 > === FarmTrack GATEWAY ===
00:00:41.010 > reset reason: BROWNOUT
"""

# Follow-up log for the v2 gateway.cpp strings: the three "no state" forms,
# (dev, seq) reply pairing vs seq-only, and the extra v2 event lines.
# seq 5 and seq 6 are used by BOTH collars on purpose: pairing on seq alone
# would match the reply for AAAA0001 seq 5 to BBBB0002's seq 5 (fix=0).
SELFTEST_FOLLOWUP_LOG = """\
10:00:00.000 > === FarmTrack GATEWAY ===
10:00:00.010 > reset reason: POWERON
10:00:01.000 > RX from AAAA0001 seq=4 fix=1 sats=6 rssi=-60 snr=9.0 gps_ok=1 gps_rst=0
10:00:01.100 > RX from BBBB0002 seq=4 fix=0 sats=0 rssi=-90 snr=-5.0 gps_ok=1 gps_rst=0
10:00:02.000 > upload failed, HTTP -1: connection refused
10:00:02.001 > no state to relay back - skipping downlink reply this cycle n=2
10:00:04.000 > RX from AAAA0001 seq=5 fix=1 sats=6 rssi=-60 snr=9.0 gps_ok=1 gps_rst=0
10:00:04.100 > RX from BBBB0002 seq=5 fix=0 sats=0 rssi=-90 snr=-5.0 gps_ok=1 gps_rst=0
10:00:04.600 > upload ok n=2 ms=500 heap=147000 maxblk=95000
10:00:04.601 > no state to relay back - skipping downlink reply this cycle dev=BBBB0002
10:00:04.700 > TX reply state=2 seq=5 dev=AAAA0001
10:00:07.000 > RX from AAAA0001 seq=6 fix=1 sats=6 rssi=-60 snr=9.0 gps_ok=1 gps_rst=0
10:00:07.100 > RX from BBBB0002 seq=6 fix=0 sats=0 rssi=-90 snr=-5.0 gps_ok=1 gps_rst=0
10:00:10.000 > RX from AAAA0001 seq=7 fix=1 sats=6 rssi=-60 snr=9.0 gps_ok=1 gps_rst=0
10:00:10.500 > upload ok n=3 ms=700 heap=146000 maxblk=94000
10:00:10.501 > bad response JSON: <html>
10:00:10.502 > no state to relay back - skipping downlink reply this cycle
10:00:10.600 > TX reply state=1 seq=6
10:00:11.000 > reply queue full - reply dropped
10:00:12.000 > ignored packet len=21 ver=1 - collar and gateway must both run protocol v2
10:00:13.000 > radio re-init: no uplink heard for 5 minutes
10:00:14.000 > 5 uploads in a row got no answer with WiFi up - restarting (4 queued readings lost)
10:00:14.500 > reply late, skipped seq=7 age=3600ms
"""

# Second follow-up log: the reliability pass (gateway.cpp md5 98d30555...).
# Abridged - e.g. the firmware prints the "not restarting yet" line only after
# 5 transport failures in a row. What matters is that every line is in the
# exact firmware format and the counts below can be worked out by hand.
# The -11 counts as a server error in the firmware (fresh connection, no
# answer), so 500, -11, 503 is the 3 errors that trigger the split.
SELFTEST_FOLLOWUP2_LOG = """\
11:00:00.000 > === FarmTrack GATEWAY ===
11:00:00.010 > reset reason: POWERON
11:00:01.000 > RX from AAAA0001 seq=1 fix=1 sats=6 rssi=-60 snr=9.0 gps_ok=1 gps_rst=0
11:00:01.100 > RX from BBBB0002 seq=1 fix=1 sats=6 rssi=-70 snr=8.0 gps_ok=1 gps_rst=0
11:00:02.000 > upload failed, HTTP -1: connection refused
11:00:02.001 > no state to relay back - skipping downlink reply this cycle n=2
11:00:02.500 > 5 uploads in a row got no answer, but the server hasn't answered since boot - not restarting yet (queue kept)
11:00:04.000 > upload failed, HTTP 500: {"message":"canceling statement due to statement timeout"}
11:00:04.001 > no state to relay back - skipping downlink reply this cycle n=2
11:00:06.000 > upload failed, HTTP -11: read Timeout
11:00:06.001 > no state to relay back - skipping downlink reply this cycle n=2
11:00:09.000 > upload failed, HTTP 503: unavailable
11:00:09.001 > no state to relay back - skipping downlink reply this cycle n=2
11:00:09.002 > batch of 2 failed 3 times - retrying 1 at a time
11:00:13.000 > upload failed, HTTP 503: unavailable
11:00:13.001 > no state to relay back - skipping downlink reply this cycle n=1
11:00:18.000 > upload failed, HTTP 503: unavailable
11:00:18.001 > no state to relay back - skipping downlink reply this cycle n=1
11:00:24.000 > upload failed, HTTP 503: unavailable
11:00:24.001 > no state to relay back - skipping downlink reply this cycle n=1
11:00:24.002 > dropped reading dev=AAAA0001 seq=1 after 3 server errors
11:00:25.000 > response truncated at 4096 bytes
11:00:25.001 > upload ok n=1 ms=900 heap=145000 maxblk=93000
11:00:25.002 > bad response JSON: [{"device_id":"FT-BBBB0002","se
11:00:25.003 > no state to relay back - skipping downlink reply this cycle
11:00:30.000 > RX from AAAA0001 seq=2 fix=1 sats=6 rssi=-60 snr=9.0 gps_ok=1 gps_rst=0
11:00:30.500 > upload failed, HTTP 400: {"message":"invalid input"}
11:00:30.501 > no state to relay back - skipping downlink reply this cycle n=1
11:00:33.000 > RX from BBBB0002 seq=2 fix=1 sats=6 rssi=-70 snr=8.0 gps_ok=1 gps_rst=0
11:00:33.500 > upload ok n=1 ms=400 heap=145000 maxblk=93000
11:00:33.600 > TX reply state=0 seq=2 dev=BBBB0002
11:00:33.700 > uplink lost: it arrived while reply seq=2 was being sent
11:00:40.000 > dropped reading dev=BBBB0002 seq=3 after 3 server errors
11:00:41.000 > dropped reading dev=AAAA0001 seq=4 after 3 server errors
11:00:50.000 > upload task create failed - restarting in 1s
11:00:51.000 > === FarmTrack GATEWAY ===
11:00:51.010 > reset reason: SW
"""

SELFTEST_POINTS = """\
point,label,dist_m,start,end
W1,crosses midnight,10,23:59:45,00:00:10
W2,collar reboot,20,00:00:04,00:00:27
W3,uint16 wrap,30,00:00:29,00:00:40
W4,single packet,40,23:59:40,23:59:42
W5,outside log,50,12:00:00,12:05:00
"""


def selftest():
    n = [0]

    def check(cond, msg):
        n[0] += 1
        if not cond:
            raise AssertionError(f"selftest check {n[0]} failed: {msg}")

    def t(s):
        return parse_time(s).time()

    log = load_lines(io.StringIO(SELFTEST_LOG))
    rx, ev = log["rx"], log["events"]

    # parsing: old and new RX formats
    check(len(rx) == 15, f"15 RX lines, got {len(rx)}")
    check(rx[0]["gps_ok"] is None and rx[0]["gps_rst"] is None,
          "v1 RX line has no gps fields")
    check(rx[3]["gps_ok"] == 1 and rx[3]["gps_rst"] == 0, "v2 RX gps fields")
    check(rx[4]["gps_rst"] == 1, "gps_rst=1 parsed")
    # midnight unwrap: 00:00:02 is the day after 23:59:50
    check(rx[3]["t"] - rx[2]["t"] == timedelta(seconds=12),
          "midnight unwrap gives +12 s, not -24 h")

    # percentile matches PostgreSQL percentile_cont
    check(abs(percentile([1, 2, 3, 4], 0.95) - 3.85) < 1e-9, "p95 of 1..4")
    check(percentile([7], 0.95) == 7, "p95 of one value")

    # wrap vs reboot classifier
    def r(seq, secs):
        return {"seq": seq, "t": datetime(1900, 1, 1) + timedelta(seconds=secs)}
    check(classify_backstep(r(65535, 0), r(0, 3)) == "wrap", "65535->0 in 3 s")
    check(classify_backstep(r(100, 0), r(0, 3)) == "reboot", "100->0 in 3 s")
    check(classify_backstep(r(65000, 0), r(300, 1200)) == "reboot",
          "836 steps in 20 min is faster than the collar can send")
    check(classify_backstep({"seq": 65535, "t": None}, {"seq": 0, "t": None})
          == "wrap", "no-timestamp fallback: wrap")
    check(classify_backstep({"seq": 500, "t": None}, {"seq": 0, "t": None})
          == "reboot", "no-timestamp fallback: reboot")

    # whole log: AAAA seg1 10..15 (sent 6, got 5, 1 dup), AAAA seg2 0..3
    # (sent 4, got 3), BBBB 65530..65538 unwrapped (sent 9, got 6)
    d = pdr(rx)
    check(d["expected"] == 19 and d["received"] == 14,
          f"whole log 14/19, got {d['received']}/{d['expected']}")
    check(len(d["reboots"]) == 1 and d["reboots"][0]["dev"] == "AAAA0001",
          "one reboot, on AAAA0001")
    check(len(d["wraps"]) == 1 and d["wraps"][0]["dev"] == "BBBB0002",
          "one wrap, on BBBB0002")
    check(d["duplicates"] == 1, "one duplicate seq line")
    check(len(d["segments"]) == 3, "three segments")

    # W1 crosses midnight (the old time-of-day comparison matched nothing)
    rows, st = select_window(log, t("23:59:45"), t("00:00:10"), "FT-AAAA0001")
    check(st == "ok" and [x["seq"] for x in rows] == [13, 14, 15, 15],
          f"midnight window rows, got {[x['seq'] for x in rows]}")
    d = pdr(rows)
    check(d["expected"] == 3 and d["received"] == 3 and d["duplicates"] == 1,
          "midnight window PDR 3/3 with 1 duplicate")
    # a midnight-crossing window on a log that starts after midnight
    tail = load_lines(io.StringIO(SELFTEST_LOG.split("23:59:52.000")[1]))
    rows, st = select_window(tail, t("23:58:00"), t("00:00:03"), "AAAA0001")
    check(st == "ok" and [x["seq"] for x in rows] == [14],
          "window starting before a post-midnight log")

    # W2 collar reboot inside the window: [15,15] then [0,1,3]
    rows, st = select_window(log, t("00:00:04"), t("00:00:27"), "AAAA0001")
    d = pdr(rows)
    check(d["expected"] == 5 and d["received"] == 4,
          f"reboot window 4/5, got {d['received']}/{d['expected']}")
    check(len(d["reboots"]) == 1 and d["reboots"][0]["from"] == 15
          and d["reboots"][0]["to"] == 0, "reboot 15 -> 0")

    # W3 wrap: 65534, 65535, 0, 2 -> one segment, sent 5, got 4
    rows, st = select_window(log, t("00:00:29"), t("00:00:40"), "BBBB0002")
    d = pdr(rows)
    check(d["expected"] == 5 and d["received"] == 4 and not d["reboots"]
          and len(d["wraps"]) == 1, "wrap window 4/5, no reboot")

    # W4 single packet, W5 outside the log
    rows, st = select_window(log, t("23:59:40"), t("23:59:42"), "AAAA0001")
    check(len(rows) == 1 and pdr(rows) is None, "single packet: PDR undefined")
    rows, st = select_window(log, t("12:00:00"), t("12:05:00"))
    check(st == "outside" and rows == [], "window outside the log")

    # events
    kinds = [e["kind"] for e in ev]
    check(kinds.count("GATEWAY REBOOT") == 2 and kinds.count("BROWNOUT RESET") == 1,
          "2 banners + 1 brownout")
    check(kinds.count("upload failed") == 1 and kinds.count("no downlink sent") == 1,
          "v1 failure lines")
    ups = [e for e in ev if e["kind"] == "upload ok"]
    check(len(ups) == 3 and sum(e["n"] for e in ups) == 5, "3 uploads, 5 readings")
    s = stats([e["ms"] for e in ups])
    check(s["median"] == 600 and abs(s["p95"] - 1140) < 1e-9,
          f"upload ms median 600 p95 1140, got {s['median']} {s['p95']}")
    check(min(e["maxblk"] for e in ups) == 90000, "min maxblk")
    late = [e for e in ev if e["kind"] == "reply late"]
    check(len(late) == 1 and late[0]["seq"] == 15 and late[0]["age_ms"] == 3900,
          "reply late parsed")
    q = [e for e in ev if e["kind"] == "queue full"]
    check(len(q) == 1 and q[0]["seq"] == 1, "queue full parsed")
    reasons = [e["reason"] for e in ev if e["kind"] == "reset reason"]
    check(reasons == ["BROWNOUT"], f"reset reasons, got {reasons}")
    tx = [e for e in ev if e["kind"] == "TX reply"]
    check([e["state"] for e in tx] == [2, 1, 0, 0, 2], "TX reply states")
    check([e["seq"] for e in tx] == [None, None, 14, 15, 3], "TX reply seq echo")
    bad = [e for e in tx if e["state"] != 0 and rx[e["rx_idx"]]["fix"] == 0]
    check(len(bad) == 2, "two non-SAFE replies to fix=0 uplinks (v1 + v2 pairing)")

    # full report renders without error and says the right things
    pts = []
    for row in csv.DictReader(io.StringIO(SELFTEST_POINTS)):
        pts.append({"row": row, "start": parse_time(row["start"]).time(),
                    "end": parse_time(row["end"]).time()})
    text = "\n".join(build_report(log, pts, None, "selftest"))
    for needle in ("crosses midnight", "collar reboots seen (seq restarted): 1",
                   "seq wrapped past 65535: 1", "n/a (1 packet)",
                   "window not in log", "upload round trip (ms): n 3",
                   "min 90000", "GPS NMEA arriving (gps_ok=1)",
                   "older-format RX lines had no gps_ok field",
                   "non-SAFE replies to an uplink with fix=0: 2",
                   "reset reasons logged: 1", "line 31: BROWNOUT"):
        check(needle in text, f"report contains {needle!r}")
    # an old-format-only log must not claim v2 counters
    old = load_lines(io.StringIO(SELFTEST_LOG.split("00:00:02.000")[0]))
    text = "\n".join(build_report(old, None, None, "old"))
    check("predates protocol v2" in text and "not in this log" in text,
          "v1-only log reported as pre-v2")
    check("readings with no server state (no downlink relayed): 1" in text
          and "in failed batches" not in text,
          "v1 plain no-state line counts 1, no v2 breakdown")

    # --- follow-up: v2 gateway.cpp strings ---
    log = load_lines(io.StringIO(SELFTEST_FOLLOWUP_LOG))
    rx, ev = log["rx"], log["events"]
    ns = [e for e in ev if e["kind"] == "no downlink sent"]
    check([(e["form"], e["n"]) for e in ns]
          == [("failed batch", 2), ("device without state", 1),
              ("bad-JSON batch", 3)],
          f"no-state forms and counts, got {[(e['form'], e['n']) for e in ns]}")
    check(ns[1]["dev"] == "BBBB0002", "dev= parsed on no-state line")
    check(sum(e["n"] for e in ns) == 6, "no-state readings sum to 6")
    tx = [e for e in ev if e["kind"] == "TX reply"]
    check([e["paired_by"] for e in tx] == ["dev+seq", "seq"],
          f"pairing methods, got {[e['paired_by'] for e in tx]}")
    check(tx[0]["dev"] == "AAAA0001" and rx[tx[0]["rx_idx"]]["dev"] == "AAAA0001"
          and rx[tx[0]["rx_idx"]]["fix"] == 1,
          "dev+seq pairs the reply with AAAA0001 seq 5, not BBBB0002 seq 5")
    check(rx[tx[1]["rx_idx"]]["dev"] == "BBBB0002",
          "seq-only fallback pairs with the latest seq 6 (BBBB0002)")
    bad = [e for e in tx if e["state"] != 0 and rx[e["rx_idx"]]["fix"] == 0]
    check(len(bad) == 1, f"one non-SAFE reply to a fix=0 uplink, got {len(bad)}")
    kinds = [e["kind"] for e in ev]
    for kind in ("reply queue full", "ignored packet", "radio re-init",
                 "upload restart", "reply late"):
        check(kinds.count(kind) == 1, f"one {kind!r} event")
    ig = next(e for e in ev if e["kind"] == "ignored packet")
    check(ig["len"] == 21 and ig["ver"] == 1, "ignored packet len/ver")
    check(next(e for e in ev if e["kind"] == "upload restart")["lost"] == 4,
          "restart lost count")
    text = "\n".join(build_report(log, None, None, "followup"))
    for needle in ("readings with no server state (no downlink relayed): 6",
                   "2 in failed batches (`n=` lines;",
                   "3 in batches whose response JSON was unreadable, 1 line(s)",
                   "1 devices left without a state in an answered batch",
                   "lower bound",
                   "replies dropped because the reply queue was full: 1",
                   "restarts after repeated unanswered uploads: 1 "
                   "(4 queued readings lost)",
                   "radio re-inits: 1", "no uplink heard for 5 minutes",
                   "versions seen: 1",
                   "non-SAFE replies to an uplink with fix=0: 1 of 2 replies "
                   "matched to their uplink (matched by dev+seq / seq)"):
        check(needle in text, f"follow-up report contains {needle!r}")
    # v1 collar talking to a v2 gateway: no RX lines, only "ignored packet"
    mism = load_lines(io.StringIO(
        "10:00:00.000 > === FarmTrack GATEWAY ===\n"
        "10:00:05.000 > ignored packet len=21 ver=1 - collar and gateway must "
        "both run protocol v2\n"))
    text = "\n".join(build_report(mism, None, None, "mismatch"))
    check("different protocol versions" in text and "versions seen: 1" in text,
          "version mismatch explained when there are no RX lines")

    # --- second follow-up: reliability-pass lines ---
    log = load_lines(io.StringIO(SELFTEST_FOLLOWUP2_LOG))
    ev = log["events"]
    ns = [e for e in ev if e["kind"] == "no downlink sent"]
    check([e.get("http") for e in ns if e["form"] == "failed batch"]
          == [-1, 500, -11, 503, 503, 503, 503, 400],
          "HTTP code attached to each n= line")
    check(sum(e["n"] for e in ns) == 13, "no-state attempts 12 + bad-JSON 1")
    kinds = [e["kind"] for e in ev]
    for kind, k in (("dropped reading", 3), ("batch split", 1),
                    ("response truncated", 1), ("uplink lost", 1),
                    ("restart deferred", 1), ("self restart", 1),
                    ("upload restart", 0), ("reset reason", 2),
                    ("GATEWAY REBOOT", 2)):
        check(kinds.count(kind) == k, f"{k} x {kind!r}, got {kinds.count(kind)}")
    sp = next(e for e in ev if e["kind"] == "batch split")
    check((sp["size"], sp["times"], sp["limit"]) == (2, 3, 1), "batch split fields")
    check([(e["dev"], e["seq"]) for e in ev if e["kind"] == "dropped reading"]
          == [("AAAA0001", 1), ("BBBB0002", 3), ("AAAA0001", 4)],
          "dropped reading dev/seq")
    check(SELF_RESTART_RE.search(
        "LoRa FAILED - check 3V3 power, SPI wiring (18/19/23), NSS/RST/DIO0 "
        "- restarting in 5s") is not None, "v2 LoRa FAILED restart recognised")
    check(SELF_RESTART_RE.search(
        "LoRa FAILED - check 3V3 power, SPI wiring (18/19/23), NSS/RST/DIO0")
        is None, "v1 LoRa FAILED (hangs, no restart) not counted as a restart")
    text = "\n".join(build_report(log, None, None, "followup2"))
    for needle in ("readings with no server state (no downlink relayed): 13",
                   "12 in failed batches (`n=` lines;", "8 line(s)",
                   "not a count of readings lost",
                   "readings dropped by the gateway after repeated server "
                   "errors (never stored): 3",
                   "  - FT-AAAA0001: 2 (seq 1, 4)",
                   "  - FT-BBBB0002: 1 (seq 3)",
                   "readings rejected by the server (HTTP 4xx, batch dropped "
                   "without retry; never stored): 1 in 1 batch(es), HTTP 400",
                   "uplinks lost because a reply was being transmitted "
                   "(radio side): 1",
                   "batch splits after repeated server errors: 1 (2→1)",
                   "server responses truncated: 1 (at 4096 bytes)",
                   "restarts after repeated unanswered uploads: 0 "
                   "(0 queued readings lost)",
                   "restarts deferred because the server had not answered "
                   "since boot (queue kept): 1",
                   "other self-restarts announced by the gateway: 1",
                   "upload task create failed - restarting in 1s"):
        check(needle in text, f"follow-up 2 report contains {needle!r}")
    # the first follow-up log (no reliability-pass lines) reports zeros
    text = "\n".join(build_report(load_lines(io.StringIO(SELFTEST_FOLLOWUP_LOG)),
                                  None, None, "followup"))
    check("after repeated server errors (never stored): 0" in text
          and "batch splits after repeated server errors: 0" in text
          and "restarts deferred because the server had not answered since "
              "boot (queue kept): 0" in text,
          "zeros when the reliability-pass lines are absent")

    print(f"SELFTEST PASSED ({n[0]} checks)")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("log", nargs="?")
    ap.add_argument("--points", help="CSV of measurement windows")
    ap.add_argument("--device", default=None,
                    help="filter windows to one collar, e.g. FT-1A2B3C4D "
                         "(the FT- prefix is optional)")
    ap.add_argument("--selftest", action="store_true",
                    help="run the parser on an embedded synthetic log and exit")
    args = ap.parse_args(argv)
    if args.selftest:
        return selftest()
    if not args.log:
        ap.error("a log file is required (or use --selftest)")

    log = load(args.log)
    points = read_points(args.points) if args.points else None
    print("\n".join(build_report(log, points, args.device,
                                 args.log.split("/")[-1])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
