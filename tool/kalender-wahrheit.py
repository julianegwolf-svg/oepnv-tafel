#!/usr/bin/env python3
"""Unabhängige Gegenprobe für kalender.js: dieselbe ICS-Datei mit
python-dateutil (RRULE) und den IANA-Zeitzonen des Systems (zoneinfo)
auflösen – also NICHT mit den VTIMEZONE-Blöcken der Datei wie kalender.js.

Aufruf: python3 -I tool/kalender-wahrheit.py <datei.ics> <von_ms> <bis_ms>
Ausgabe: JSON-Liste [{"start": ms, "ende": ms, "ganztags": bool, "titel": str}]
"""
import json
import re
import sys
from datetime import datetime, timedelta, timezone, date
from zoneinfo import ZoneInfo

from dateutil.rrule import rrulestr

BERLIN = ZoneInfo("Europe/Berlin")


def zone_von(tzid):
    if not tzid:
        return BERLIN  # schwebende Zeit = Ortszeit der Tafel
    m = re.match(r"^(?:GMT|UTC)([+-])(\d{2}):?(\d{2})$", tzid)
    if m:
        off = (int(m.group(2)) * 60 + int(m.group(3))) * (-1 if m.group(1) == "-" else 1)
        return timezone(timedelta(minutes=off))
    try:
        return ZoneInfo(tzid)
    except Exception:
        return BERLIN


def wert_lesen(params, wert):
    """→ (aware datetime, ganztags)"""
    if params.get("VALUE") == "DATE" or re.fullmatch(r"\d{8}", wert):
        d = datetime.strptime(wert[:8], "%Y%m%d")
        return d.replace(tzinfo=BERLIN), True
    if wert.endswith("Z"):
        return datetime.strptime(wert, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc), False
    fmt = "%Y%m%dT%H%M%S" if len(wert) == 15 else "%Y%m%dT%H%M"
    return datetime.strptime(wert, fmt).replace(tzinfo=zone_von(params.get("TZID"))), False


def zeile(line):
    kopf, _, wert = line.partition(":")
    teile = kopf.split(";")
    params = {}
    for p in teile[1:]:
        k, _, v = p.partition("=")
        params[k.upper()] = v.strip('"')
    return teile[0].upper(), params, wert.strip()


def main():
    text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
    von = datetime.fromtimestamp(int(sys.argv[2]) / 1000, tz=timezone.utc)
    bis = datetime.fromtimestamp(int(sys.argv[3]) / 1000, tz=timezone.utc)
    text = re.sub(r"\n[ \t]", "", text.replace("\r\n", "\n"))
    bloecke = re.findall(r"^BEGIN:VEVENT\n(.*?)^END:VEVENT", text, re.S | re.M)
    termine = []
    for b in bloecke:
        b = re.sub(r"^BEGIN:VALARM\n.*?^END:VALARM\n", "", b, flags=re.S | re.M)
        ev = {"exdate": [], "status": "", "titel": "", "rrule": None, "rid": None, "uid": None}
        for line in b.split("\n"):
            if ":" not in line:
                continue
            name, params, wert = zeile(line)
            if name == "SUMMARY":
                ev["titel"] = wert.replace("\\,", ",").replace("\\;", ";").replace("\\n", "\n").replace("\\\\", "\\")
            elif name == "UID":
                ev["uid"] = wert
            elif name == "STATUS":
                ev["status"] = wert.upper()
            elif name == "DTSTART":
                ev["start"], ev["ganztags"] = wert_lesen(params, wert)
            elif name == "DTEND":
                ev["ende"], _ = wert_lesen(params, wert)
            elif name == "RRULE":
                ev["rrule"] = wert
            elif name == "RECURRENCE-ID":
                ev["rid"], _ = wert_lesen(params, wert)
            elif name == "EXDATE":
                for v in wert.split(","):
                    ev["exdate"].append(wert_lesen(params, v.strip())[0])
        if "start" in ev:
            termine.append(ev)

    geaendert = {}
    for ev in termine:
        if ev["rid"] is not None and ev["uid"]:
            geaendert.setdefault(ev["uid"], set()).add(ev["rid"].timestamp())

    aus = []
    for ev in termine:
        if ev["status"] == "CANCELLED":
            continue
        start = ev["start"]
        if ev["ganztags"]:
            tage = (ev["ende"].date() - start.date()).days if "ende" in ev else 1
            tage = max(1, tage)
        else:
            dauer = (ev["ende"] - start) if "ende" in ev else timedelta(0)
        if ev["rrule"] and ev["rid"] is None:
            # dateutil rechnet in Wandzeit der Startzone (wie RFC 5545)
            naive = start.replace(tzinfo=None)
            regel = ev["rrule"]
            if "UNTIL=" in regel and not re.search(r"UNTIL=\d{8}T\d{6}Z", regel):
                pass
            # UNTIL in UTC → in Wandzeit der Startzone umrechnen (dateutil vergleicht naiv)
            m = re.search(r"UNTIL=(\d{8}T\d{6})Z", regel)
            if m:
                u = datetime.strptime(m.group(1), "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
                regel = regel.replace(m.group(0), "UNTIL=" + u.astimezone(start.tzinfo).strftime("%Y%m%dT%H%M%S"))
            m = re.search(r"UNTIL=(\d{8})(?=;|$)", regel)
            if m:
                regel = regel.replace(m.group(0), "UNTIL=" + m.group(1) + "T235959")
            r = rrulestr(regel, dtstart=naive)
            grenze = bis.astimezone(start.tzinfo).replace(tzinfo=None)
            starts = [s.replace(tzinfo=start.tzinfo) for s in r.between(naive - timedelta(seconds=1), grenze, inc=True)]
        else:
            starts = [start]
        ex = {e.timestamp() for e in ev["exdate"]}
        ex_tage = {e.date() for e in ev["exdate"]}
        weg = geaendert.get(ev["uid"], set()) if ev["rid"] is None else set()
        for s in starts:
            if s.timestamp() in ex or (ev["ganztags"] and s.date() in ex_tage):
                continue
            if s.timestamp() in weg:
                continue
            if ev["ganztags"]:
                e = datetime.combine(s.date() + timedelta(days=tage), datetime.min.time()).replace(tzinfo=BERLIN)
            else:
                e = s + dauer
            if s >= bis:
                continue
            if e > von or (e == s and s >= von):
                aus.append({"start": int(s.timestamp() * 1000), "ende": int(e.timestamp() * 1000),
                            "ganztags": ev["ganztags"], "titel": ev["titel"]})
    aus.sort(key=lambda x: (x["start"], not x["ganztags"]))
    json.dump(aus, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
