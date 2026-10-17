import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import {
  createIcs,
  escapeIcsText,
  fileNameForGroup,
  formatEventTitle,
  parseGermanDate,
  parseMediaText,
  REMINDER_OPTIONS,
} from "../app.js";
import { buildSite } from "../scripts/build-site.js";

const exampleText = await readFile(new URL("../input_example_1.txt", import.meta.url), "utf8");
const serviceWorkerSource = await readFile(new URL("../sw.js", import.meta.url), "utf8");

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? listFiles(join(directory, entry.name), path)
      : [path];
  }));
  return nestedFiles.flat();
}

async function createServiceWorkerHarness(fetchImplementation, initialEntries = []) {
  const listeners = new Map();
  const entries = new Map(initialEntries);
  const cache = {
    async match(request) {
      const key = typeof request === "string" ? request : request.url;
      return entries.get(key)?.clone();
    },
    async put(request, response) {
      const key = typeof request === "string" ? request : request.url;
      entries.set(key, response.clone());
    },
  };
  const self = {
    location: { origin: "https://example.github.io" },
    registration: { scope: "https://example.github.io/library/" },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  runInNewContext(serviceWorkerSource, {
    self,
    caches: { open: async () => cache },
    URL,
    Request,
    fetch: fetchImplementation,
    console,
  });
  return { cache, entries, fetchHandler: listeners.get("fetch") };
}

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

test("builds a Pages artifact with only the explicitly public app files", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "medienrueckgabe-pages-"));
  try {
    await buildSite(outputDirectory);
    const files = await listFiles(outputDirectory);

    assert.deepEqual(files.sort(), [
      "app.js",
      "icons/app-192.png",
      "icons/app-512.png",
      "icons/app.svg",
      "index.html",
      "manifest.webmanifest",
      "styles.css",
      "sw.js",
    ]);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("configures an installable project-path-safe offline app shell", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(
    new URL("../manifest.webmanifest", import.meta.url),
    "utf8"
  ));
  const worker = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  const examplePage = new URL("https://example.github.io/library/");

  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /href="\.\/manifest\.webmanifest"/);
  assert.match(html, /src="\.\/app\.js"/);
  assert.equal(new URL(manifest.start_url, examplePage).pathname, "/library/");
  assert.equal(new URL(manifest.scope, examplePage).pathname, "/library/");
  const pngIcons = manifest.icons.filter(({ type }) => type === "image/png");
  assert.deepEqual(
    pngIcons.map(({ sizes }) => sizes).sort(),
    ["192x192", "512x512"]
  );
  for (const icon of pngIcons) {
    const dimensions = icon.sizes.split("x").map(Number);
    const image = await readFile(new URL(`../${icon.src.slice(2)}`, import.meta.url));
    assert.equal(image.readUInt32BE(16), dimensions[0]);
    assert.equal(image.readUInt32BE(20), dimensions[1]);
    assert.ok(worker.includes(`"${icon.src}"`));
  }
  assert.ok(manifest.icons.every((icon) =>
    new URL(icon.src, examplePage).pathname.startsWith("/library/")
  ));
  assert.match(worker, /cache\.addAll\(APP_SHELL\)/);
  assert.match(worker, /if \(!isAppShellNavigation && !APP_SHELL_URLS\.has\(requestUrl\.href\)\) return;/);
  assert.match(worker, /cache\.put\(cacheRequest, response\.clone\(\)\)/);
});

test("refreshes cached shell files online and falls back for network and HTTP errors", async () => {
  const appScriptUrl = "https://example.github.io/library/app.js";
  const appRequest = new Request(appScriptUrl);
  const appShellCache = [[appScriptUrl, new Response("cached app script")]];

  for (const fetchImplementation of [
    async () => { throw new TypeError("offline"); },
    async () => new Response("unavailable", { status: 503 }),
  ]) {
    const harness = await createServiceWorkerHarness(fetchImplementation, appShellCache);
    let responsePromise;
    harness.fetchHandler({
      request: appRequest,
      respondWith(response) {
        responsePromise = response;
      },
    });

    assert.equal(await (await responsePromise).text(), "cached app script");
  }

  const updatedHarness = await createServiceWorkerHarness(
    async () => new Response("fresh app script"),
    appShellCache
  );
  let updatedResponse;
  updatedHarness.fetchHandler({
    request: appRequest,
    respondWith(response) {
      updatedResponse = response;
    },
  });
  assert.equal(await (await updatedResponse).text(), "fresh app script");
  assert.equal(
    await (await updatedHarness.cache.match(appScriptUrl)).text(),
    "fresh app script"
  );
});

test("does not intercept or cache non-app requests", async () => {
  let requestCount = 0;
  const harness = await createServiceWorkerHarness(async () => {
    requestCount += 1;
    return new Response("private");
  });
  let intercepted = false;
  harness.fetchHandler({
    request: new Request("https://example.github.io/library/private?text=local"),
    respondWith() {
      intercepted = true;
    },
  });

  assert.equal(intercepted, false);
  assert.equal(requestCount, 0);
  assert.equal(harness.entries.size, 0);
});
