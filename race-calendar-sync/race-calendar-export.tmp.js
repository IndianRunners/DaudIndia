/*
 * race-calendar-export.js
 * Original, dependency-free RFC 5545 (iCalendar) exporter for race lists.
 * Accepts caller-supplied event data; ships with no race data of its own.
 * Supports updatable feeds: stable UIDs, SEQUENCE, LAST-MODIFIED and
 * refresh-interval hints, so an organiser can republish changed details
 * (start time, gate, parking, venue) against the same event identity.
 *
 * Runs in the browser (window.RaceCalendarExport) and Node (module.exports).
 * Licence: to be chosen by the project owner (unlicensed until then).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.RaceCalendarExport = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CRLF = "\r\n";

  /* ---------- helpers ---------- */

  function pad(n, w) {
    var s = String(Math.abs(n));
    while (s.length < w) s = "0" + s;
    return (n < 0 ? "-" : "") + s;
  }

  // YYYYMMDD (local calendar date) for all-day events
  function formatDate(d) {
    return pad(d.getFullYear(), 4) + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2);
  }

  // YYYYMMDDTHHMMSSZ (UTC) for timed events
  function formatDateTimeUTC(d) {
    return pad(d.getUTCFullYear(), 4) + pad(d.getUTCMonth() + 1, 2) + pad(d.getUTCDate(), 2) +
      "T" + pad(d.getUTCHours(), 2) + pad(d.getUTCMinutes(), 2) + pad(d.getUTCSeconds(), 2) + "Z";
  }

  // RFC 5545 §3.3.11 text escaping
  function escapeText(s) {
    return String(s)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r\n/g, "\\n")
      .replace(/\r/g, "\\n")
      .replace(/\n/g, "\\n");
  }

  // RFC 5545 §3.1: content lines MUST NOT exceed 75 octets; fold with CRLF + single space.
  // Folds by UTF-8 octets without splitting a multi-byte character.
  function foldLine(line) {
    var bytes = new TextEncoder().encode(line);
    if (bytes.length <= 75) return line;
    var out = [];
    var chunk = "";
    var chunkBytes = 0;
    var limit = 75;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      var chBytes = new TextEncoder().encode(ch).length;
      if (chunkBytes + chBytes > limit) {
        out.push(chunk);
        chunk = " " + ch;
        chunkBytes = 1 + chBytes;
        limit = 75;
      } else {
        chunk += ch;
        chunkBytes += chBytes;
      }
    }
    out.push(chunk);
    return out.join(CRLF);
  }

  function line(name, params, value) {
    var l = name;
    if (params) l += ";" + params;
    l += ":" + value;
    return foldLine(l);
  }

  /*
   * UID stability is what lets an updated feed revise an existing calendar
   * entry instead of duplicating it. UIDs here are deterministic:
   * - event.id supplied  -> "<id>@<domain>"
   * - no event.id        -> hash of title|startDate|location (same input,
   *                         same UID, so a regenerated feed still matches)
   */
  function uidFor(ev, productDomain) {
    if (ev.id) return String(ev.id) + "@" + productDomain;
    var basis = [ev.title, String(ev.startDate), ev.location || ""].join("|");
    var hash = 0;
    for (var i = 0; i < basis.length; i++) {
      hash = ((hash << 5) - hash + basis.charCodeAt(i)) | 0;
    }
    return "race-" + (hash >>> 0).toString(36) + "@" + productDomain;
  }

  function toDate(v) {
    if (v instanceof Date) return v;
    var d = new Date(v);
    if (isNaN(d.getTime())) throw new Error("Invalid date: " + v);
    return d;
  }

  // Build the human-readable DESCRIPTION from the structured race fields.
  function buildDescription(ev) {
    var parts = [];
    if (ev.category) parts.push("Category: " + ev.category);
    if (ev.bib) parts.push("Bib: " + ev.bib);
    if (ev.reportingTime) parts.push("Reporting time: " + ev.reportingTime);
    if (ev.startGate) parts.push("Start gate: " + ev.startGate);
    if (ev.parking) parts.push("Parking: " + ev.parking);
    if (ev.description) parts.push(ev.description);
    if (ev.updateNotice) parts.push("UPDATED: " + ev.updateNotice);
    return parts.length ? parts.join("\n") : null;
  }

  /* ---------- public API ---------- */

  /**
   * buildICS(events, options) -> string (CRLF-delimited iCalendar)
   *
   * event = {
   *   title:        string  (required)  race name
   *   startDate:    Date | "YYYY-MM-DD" | ISO (required)  race start
   *   endDate:      same, optional (defaults: +1 day all-day, +2h timed)
   *   allDay:       boolean (default: true when startDate has no time part)
   *   location:     string  optional, venue
   *   description:  string  optional free text
   *   url:          string  optional, race website
   *   id:           string  optional stable id (recommended for updatable feeds)
   *   sequence:     integer optional revision number, default 0; bump on every
   *                 change so calendar apps replace the old entry
   *   lastModified: Date | ISO optional; defaults to generation time
   *   category:     string  optional, e.g. "Half Marathon - Open 18-35"
   *   bib:          string  optional, runner's bib number
   *   reportingTime:string  optional, e.g. "05:15 at Gate B"
   *   startGate:    string  optional, exact gate / corral
   *   parking:      string  optional, parking instructions
   *   geo:          {lat, lon} optional venue/parking coordinates (GEO property)
   *   updateNotice: string  optional, highlights what changed in this revision
   *   reminders:    array of { days?, hours?, minutes? } before start
   * }
   *
   * options = {
   *   calendarName:    string (X-WR-CALNAME), default "Race Calendar"
   *   productId:       string (UID domain part), default "daudindia.github.io"
   *   refreshInterval: string ISO-8601 duration, e.g. "PT6H". Emits
   *                    REFRESH-INTERVAL and X-PUBLISHED-TTL hints for feed use.
   *                    (Calendar apps may ignore these; they are hints only.)
   * }
   */
  function buildICS(events, options) {
    options = options || {};
    var domain = options.productId || "daudindia.github.io";
    var calName = options.calendarName || "Race Calendar";
    var now = formatDateTimeUTC(new Date());

    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      line("PRODID", null, "-//DaudIndia//Race Calendar Export//EN"),
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      line("X-WR-CALNAME", null, escapeText(calName))
    ];
    if (options.refreshInterval) {
      lines.push(line("REFRESH-INTERVAL", "VALUE=DURATION", options.refreshInterval));
      lines.push(line("X-PUBLISHED-TTL", null, options.refreshInterval));
    }

    events.forEach(function (ev) {
      if (!ev || !ev.title) throw new Error("Every event needs a title");
      if (!ev.startDate) throw new Error("Every event needs a startDate");

      var start = toDate(ev.startDate);
      var allDay = ev.allDay !== undefined ? !!ev.allDay
        : (typeof ev.startDate === "string" && !/T|\d:\d/.test(ev.startDate));

      lines.push("BEGIN:VEVENT");
      lines.push(line("UID", null, uidFor(ev, domain)));
      lines.push(line("DTSTAMP", null, now));
      lines.push(line("SEQUENCE", null, String(ev.sequence || 0)));
      lines.push(line("LAST-MODIFIED", null,
        ev.lastModified ? formatDateTimeUTC(toDate(ev.lastModified)) : now));
      if (allDay) {
        var end = ev.endDate ? toDate(ev.endDate)
          : new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
        lines.push(line("DTSTART", "VALUE=DATE", formatDate(start)));
        lines.push(line("DTEND", "VALUE=DATE", formatDate(end)));
      } else {
        var endT = ev.endDate ? toDate(ev.endDate)
          : new Date(start.getTime() + 2 * 3600 * 1000);
        lines.push(line("DTSTART", null, formatDateTimeUTC(start)));
        lines.push(line("DTEND", null, formatDateTimeUTC(endT)));
      }
      lines.push(line("SUMMARY", null, escapeText(ev.title)));
      if (ev.location) lines.push(line("LOCATION", null, escapeText(ev.location)));
      var desc = buildDescription(ev);
      if (desc) lines.push(line("DESCRIPTION", null, escapeText(desc)));
      if (ev.url) lines.push(line("URL", null, ev.url));
      if (ev.geo && typeof ev.geo.lat === "number" && typeof ev.geo.lon === "number") {
        lines.push(line("GEO", null, ev.geo.lat + ";" + ev.geo.lon));
      }

      (ev.reminders || []).forEach(function (r) {
        var trig = "-P";
        if (r.days) trig += r.days + "D";
        if (r.hours || r.minutes) {
          trig += "T";
          if (r.hours) trig += r.hours + "H";
          if (r.minutes) trig += r.minutes + "M";
        }
        if (trig === "-P") trig = "-PT15M";
        lines.push("BEGIN:VALARM");
        lines.push("ACTION:DISPLAY");
        lines.push(line("TRIGGER", null, trig));
        lines.push(line("DESCRIPTION", null, escapeText(ev.title)));
        lines.push("END:VALARM");
      });

      lines.push("END:VEVENT");
    });

    lines.push("END:VCALENDAR");
    return lines.join(CRLF) + CRLF;
  }

  /** Browser convenience: trigger a .ics download. */
  function downloadICS(filename, icsText) {
    var blob = new Blob([icsText], { type: "text/calendar;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }

  return { buildICS: buildICS, downloadICS: downloadICS };
});
