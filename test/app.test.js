import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createIcs,
  escapeIcsText,
  fileNameForGroup,
  formatEventTitle,
  parseGermanDate,
  parseMediaText,
  REMINDER_OPTIONS,
} from "../app.js";

const exampleText = await readFile(new URL("../input_example_1.txt", import.meta.url), "utf8");

test("parses the supplied library export and groups by return date and location", () => {
  const groups = parseMediaText(exampleText);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].date, "2026-11-03");
  assert.equal(groups[0].location, "Beispielbibliothek Nord");
  assert.equal(groups[0].items.length, 6);
  assert.equal(groups[1].date, "2026-11-07");
  assert.equal(groups[1].location, "Beispielbibliothek Süd");
  assert.equal(groups[1].items.length, 2);
  assert.equal(groups[1].items[0].title, "[DVD-Video] Beispielreise");
  assert.equal(
    groups[1].items[1].title,
    "[Blu-Ray] Die Reise durch den Weltraum"
  );
  const details = createIcs(groups[1], "Medienrückgabe {location} ({count})")
    .replace(/\r\n[ \t]/g, "");
  assert.match(details, /\\n- \[DVD-Video\] Beispielreise/);
  assert.match(details, /\\n- \[Blu-Ray\] Die Reise durch den Weltraum/);
});

test("does not mistake dates after Stand for return dates", () => {
  const groups = parseMediaText([
    "Markieren\t03.11.2026\tStadtbibliothek\tEin Titel",
    "000001\tverlängerbar - Stand 16.10.2026",
    "000002\tHeute verlängert - Stand 18.10.2026",
  ].join("\n"));

  assert.equal(groups.length, 1);
  assert.equal(groups[0].date, "2026-11-03");
  assert.equal(groups[0].items.length, 1);
});

test("groups same-date items by location and validates dates", () => {
  const groups = parseMediaText([
    "Markieren\t03.11.2026\tZweigstelle B\tTitel B",
    "Markieren\t03.11.2026\tZweigstelle A\tTitel A",
    "Markieren\t03.11.2026\tZweigstelle A\tNoch ein Titel",
    "Markieren\t31.02.2026\tZweigstelle A\tUngültiges Datum",
  ].join("\n"));

  assert.deepEqual(groups.map((group) => [group.location, group.items.length]), [
    ["Zweigstelle A", 2],
    ["Zweigstelle B", 1],
  ]);
  assert.equal(parseGermanDate("31.02.2026"), null);
});

test("formats title placeholders and escapes calendar text", () => {
  const group = {
    location: "Stadtbibliothek",
    items: [{ title: "Buch" }, { title: "Film" }],
  };

  assert.equal(
    formatEventTitle("Medienrückgabe {location} ({count})", group),
    "Medienrückgabe Stadtbibliothek (2)"
  );
  assert.equal(escapeIcsText("Titel, Teil 2; Pfad\\Name\nZeile"), "Titel\\, Teil 2\\; Pfad\\\\Name\\nZeile");
});

test("creates an all-day ICS event with default reminders at the selected times", () => {
  const ics = createIcs({
    date: "2026-11-03",
    location: "Stadtbibliothek im HP8",
    items: [{ title: "Kosmologie" }, { title: "C't: KI-Wissen" }],
  }, "Medienrückgabe {location} ({count})");

  assert.match(ics, /X-WR-TIMEZONE:Europe\/Berlin/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261103/);
  assert.match(ics, /DTEND;VALUE=DATE:20261104/);
  assert.match(ics, /SUMMARY:Medienrückgabe Stadtbibliothek im HP8 \(2\)/);
  assert.match(ics, /LOCATION:Stadtbibliothek im HP8/);
  const unfoldedIcs = ics.replace(/\r\n[ \t]/g, "");
  assert.match(unfoldedIcs, /DESCRIPTION:Bitte folgende Medien zurückgeben \(Stadtbibliothek im HP8\):\\n- Kosmologie\\n- C't: KI-Wissen/);
  assert.match(ics, /TRIGGER;VALUE=DATE-TIME:20261101T160000Z/);
  assert.match(ics, /TRIGGER;VALUE=DATE-TIME:20261102T160000Z/);
  assert.match(ics, /TRIGGER;VALUE=DATE-TIME:20261103T060000Z/);
  assert.equal((ics.match(/BEGIN:VALARM/g) ?? []).length, 3);
  assert.ok(ics.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75));
  assert.equal(fileNameForGroup({ date: "2026-11-03", location: "Stadtbibliothek im HP8" }), "medienrueckgabe-2026-11-03-stadtbibliothek-im-hp8.ics");
});

test("includes only selected reminders in the calendar file", () => {
  const group = {
    date: "2026-11-03",
    location: "Stadtbibliothek",
    items: [{ title: "Buch" }],
  };
  const ics = createIcs(group, "Medienrückgabe", [
    REMINDER_OPTIONS[0],
    REMINDER_OPTIONS[2],
  ]);

  assert.match(ics, /TRIGGER;VALUE=DATE-TIME:20261101T160000Z/);
  assert.match(ics, /TRIGGER;VALUE=DATE-TIME:20261103T060000Z/);
  assert.doesNotMatch(ics, /TRIGGER;VALUE=DATE-TIME:20261102T160000Z/);
  assert.equal((ics.match(/BEGIN:VALARM/g) ?? []).length, 2);
});

test("uses customized German-local reminder times and writes the event location", () => {
  const ics = createIcs({
    date: "2026-11-03",
    location: "Stadtbibliothek, HP8",
    items: [{ title: "Buch" }],
  }, "Medienrückgabe", [
    { daysBefore: 2, time: "17:30" },
    { daysBefore: 1, time: "16:45" },
    { daysBefore: 0, time: "07:00" },
  ]);

  assert.match(ics, /TRIGGER;VALUE=DATE-TIME:20261101T163000Z/);
  assert.match(ics, /TRIGGER;VALUE=DATE-TIME:20261102T154500Z/);
  assert.match(ics, /TRIGGER;VALUE=DATE-TIME:20261103T060000Z/);
  assert.match(ics, /LOCATION:Stadtbibliothek\\, HP8/);
});

test("keeps reminder wall-clock times correct across German daylight-saving changes", () => {
  const ics = createIcs({
    date: "2026-03-30",
    location: "Stadtbibliothek",
    items: [{ title: "Buch" }],
  }, "Medienrückgabe");

  assert.match(ics, /TRIGGER;VALUE=DATE-TIME:20260328T160000Z/);
  assert.match(ics, /TRIGGER;VALUE=DATE-TIME:20260329T150000Z/);
  assert.match(ics, /TRIGGER;VALUE=DATE-TIME:20260330T050000Z/);
});

test("rejects malformed reminder times rather than silently exporting incorrect alarms", () => {
  assert.throws(() => createIcs({
    date: "2026-11-03",
    location: "Stadtbibliothek",
    items: [{ title: "Buch" }],
  }, "Medienrückgabe", [{ daysBefore: 0, time: "25:00" }]), RangeError);
});
