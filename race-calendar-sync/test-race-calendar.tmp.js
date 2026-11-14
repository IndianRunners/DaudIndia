// Conformance tests for race-calendar-export.js (RFC 5545 shape + update semantics)
const RCE = require("./race-calendar-export.js");

let failures = 0;
function check(name, cond) {
  if (cond) console.log("PASS " + name);
  else { console.log("FAIL " + name); failures++; }
}

const ics = RCE.buildICS([
  {
    title: "Example City Marathon, 10K & Half; 2027 edition",
    startDate: "2027-01-17",
    location: "Pune, Maharashtra",
    description: "Flat city course.\nSecond line with, commas; semicolons\\backslash",
    url: "https://example.invalid/race",
    id: "example-marathon-2027",
    reminders: [{ days: 2 }, { hours: 3 }]
  },
  {
    title: "Night 5K with a long name containing an accented character cafe runner test",
    startDate: new Date(Date.UTC(2027, 1, 5, 14, 30, 0)), // timed event
    allDay: false,
    location: "Mumbai"
  }
], { calendarName: "Test Races" });

// Unfold continuation lines for substring checks
const unfolded = ics.split("\r\n").reduce((acc, l) => {
  if (l.startsWith(" ") && acc.length) acc[acc.length - 1] += l.slice(1);
  else acc.push(l);
  return acc;
}, []).join("\r\n");

check("CRLF only", /\r\n/.test(ics) && !/[^\r]\n/.test(ics));
check("envelope", ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
check("VERSION", ics.includes("VERSION:2.0\r\n"));
check("PRODID", ics.includes("PRODID:-//DaudIndia//Race Calendar Export//EN\r\n"));
check("UID per event", (ics.match(/UID:/g) || []).length === 2);
check("DTSTAMP per event", (ics.match(/DTSTAMP:/g) || []).length === 2);
check("escaped comma in summary", unfolded.includes("Example City Marathon\\, 10K & Half\\; 2027 edition"));
check("escaped description", unfolded.includes("commas\\; semicolons\\\\backslash"));
check("escaped newline", unfolded.includes("Flat city course.\\nSecond line"));
check("all-day DTSTART", ics.includes("DTSTART;VALUE=DATE:20270117"));
check("all-day DTEND +1d", ics.includes("DTEND;VALUE=DATE:20270118"));
check("timed DTSTART UTC", ics.includes("DTSTART:20270205T143000Z"));
check("timed DTEND default +2h", ics.includes("DTEND:20270205T163000Z"));
check("alarm -P2D", ics.includes("TRIGGER:-P2D"));
check("alarm -PT3H", ics.includes("TRIGGER:-PT3H"));
const lines = ics.split("\r\n");
const tooLong = lines.filter(l => new TextEncoder().encode(l).length > 75);
check("max 75 octets/line", tooLong.length === 0);
check("has folded continuation", lines.some(l => l.startsWith(" ")));
check("location", unfolded.includes("LOCATION:Pune\\, Maharashtra"));
check("url", ics.includes("URL:https://example.invalid/race"));
check("no U+FFFD", !ics.includes("�"));

/* --- update-semantics tests --- */

// Personalised race fields land in DESCRIPTION
const reg = RCE.buildICS([{
  title: "Demo Marathon",
  startDate: "2027-02-07",
  id: "reg-abc123",
  category: "Half Marathon - Open 18-35",
  bib: "A12345",
  reportingTime: "05:15 at Gate B",
  startGate: "Gate B, Corral 2",
  parking: "North lot, FC Road side",
  geo: { lat: 18.5204, lon: 73.8567 },
  sequence: 3,
  lastModified: new Date(Date.UTC(2027, 0, 20, 10, 0, 0))
}], { refreshInterval: "PT6H" });
const regU = reg.split("\r\n").reduce((acc, l) => {
  if (l.startsWith(" ") && acc.length) acc[acc.length - 1] += l.slice(1);
  else acc.push(l);
  return acc;
}, []).join("\r\n");

check("SEQUENCE emitted", reg.includes("SEQUENCE:3"));
check("LAST-MODIFIED emitted", reg.includes("LAST-MODIFIED:20270120T100000Z"));
check("category in description", regU.includes("Category: Half Marathon - Open 18-35"));
check("bib in description", regU.includes("Bib: A12345"));
check("reporting time in description", regU.includes("Reporting time: 05:15 at Gate B"));
check("start gate in description", regU.includes("Start gate: Gate B\\, Corral 2"));
check("parking in description", regU.includes("Parking: North lot\\, FC Road side"));
check("GEO property", reg.includes("GEO:18.5204;73.8567"));
check("refresh hints", reg.includes("REFRESH-INTERVAL;VALUE=DURATION:PT6H") && reg.includes("X-PUBLISHED-TTL:PT6H"));
check("stable UID from id", reg.includes("UID:reg-abc123@daudindia.github.io"));

// Same input twice -> identical UIDs (regenerated feed updates instead of duplicating)
const a = RCE.buildICS([{ title: "Same Race", startDate: "2027-05-01" }]);
const b = RCE.buildICS([{ title: "Same Race", startDate: "2027-05-01" }]);
const uidA = a.match(/UID:(\S+)/)[1];
const uidB = b.match(/UID:(\S+)/)[1];
check("deterministic UID without id", uidA === uidB);
check("default SEQUENCE 0", a.includes("SEQUENCE:0"));

console.log(failures === 0 ? "ALL TESTS PASSED" : failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
