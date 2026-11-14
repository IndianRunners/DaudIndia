# Race calendar sync - simulated demo

Concept demo: a runner registers for a race and a personalised event lands in their
calendar (category, bib, reporting time, start gate, exact venue, parking, reminders).
When the organiser changes details, the entry is revised against the same event identity.

**Everything here is simulated and fictional.** No live integration with any race
platform, no real race data, no accounts, no server.

## What's here

- `race-calendar-export.js` - original, dependency-free RFC 5545 (iCalendar) generator.
  Stable UIDs, SEQUENCE, LAST-MODIFIED, GEO, refresh-interval hints, personalised race
  fields and VALARM reminders. Runs in the browser and in Node. Ships with no race data.
- `test-race-calendar.js` - 32 conformance tests: `node test-race-calendar.js`.
  Output was also cross-validated with an independent iCalendar parser.
- `demo.html` - self-contained interactive demo; open it in any browser. Walks
  registration -> personalised calendar entry -> simulated organiser change ->
  revised entry. The "Add to my calendar" buttons download real, valid .ics files.

## Honest limits - what a real version would need

- **Updates are not instant.** A one-time .ics download never updates. A subscribed
  calendar feed (webcal link) updates only when the calendar app next refreshes; that
  timing is controlled by the calendar app. Re-importing a downloaded .ics by hand may
  create a duplicate entry instead of updating.
- **Urgent changes need a second channel.** A same-day gate or time change cannot rely
  on feed refresh alone; the organiser also needs a direct alert channel.
- **Real integration needs the registration and organiser side.** A registration hook
  (per-registration "add my race to my calendar" link or a tokenised feed URL) and
  organisers posting changes as the source of truth. Neither exists in this demo, and
  automatic updates should not be promised without them.

## Licence

No licence chosen yet. All rights reserved by the owner until one is picked.
