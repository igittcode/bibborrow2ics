const DATE_PATTERN = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const DEFAULT_TITLE_TEMPLATE = "Medienrückgabe {location} ({count})";
export const REMINDER_OPTIONS = [
  { id: "two-days-1700", label: "2 Tage vorher", daysBefore: 2, time: "17:00" },
  { id: "one-day-1700", label: "1 Tag vorher", daysBefore: 1, time: "17:00" },
  { id: "same-day-0700", label: "Am Rückgabetag", daysBefore: 0, time: "07:00" },
];

export function parseGermanDate(value) {
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) return null;

  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${yearText}-${monthText}-${dayText}`;
}

function isStandaloneFilmMediaType(title) {
  return /^\[(?:DVD(?:-Video)?|Blu[- ]?Ray)\]$/i.test(title);
}

export function parseMediaText(text) {
  const items = [];
  const lines = text.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const columns = line.split("\t");
    if (columns[0]?.trim() !== "Markieren" || columns.length < 4) continue;

    const date = parseGermanDate(columns[1] ?? "");
    const location = columns[2]?.trim();
    let title = columns.slice(3).join("\t").trim();
    if (!date || !location || !title) continue;

    if (isStandaloneFilmMediaType(title)) {
      const filmTitleLine = lines
        .slice(index + 1)
        .find((nextLine) => nextLine.trim() && !nextLine.startsWith("Markieren\t"));
      const filmTitle = filmTitleLine?.split(/\s+\/\s+/)[0]?.trim();
      if (filmTitle) title = `${title} ${filmTitle}`;
    }

    items.push({ date, location, title });
  }

  const groups = new Map();
  for (const item of items) {
    const id = `${item.date}::${item.location}`;
    const group = groups.get(id) ?? {
      id,
      date: item.date,
      location: item.location,
      items: [],
    };
    group.items.push(item);
    groups.set(id, group);
  }

  return [...groups.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || a.location.localeCompare(b.location, "de")
  );
}

export function formatEventTitle(template, group) {
  return template
    .replaceAll("{location}", group.location)
    .replaceAll("{count}", String(group.items.length));
}

export function escapeIcsText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldIcsLine(line) {
  const chunks = [];
  let chunk = "";
  let byteLength = 0;

  for (const character of line) {
    const characterBytes = new TextEncoder().encode(character).length;
    if (byteLength + characterBytes > 75) {
      chunks.push(chunk);
      chunk = " ";
      byteLength = 1;
    }
    chunk += character;
    byteLength += characterBytes;
  }
  chunks.push(chunk);
  return chunks.join("\r\n");
}

function nextDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return [
    String(next.getUTCFullYear()).padStart(4, "0"),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("");
}

function reminderDateTime(date, daysBefore, time) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) {
    throw new RangeError(`Invalid reminder time: ${time}`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const [year, month, day] = date.split("-").map(Number);
  const alarmDate = new Date(Date.UTC(year, month - 1, day - daysBefore));
  const targetLocalTime = Date.UTC(
    alarmDate.getUTCFullYear(),
    alarmDate.getUTCMonth(),
    alarmDate.getUTCDate(),
    hour,
    minute
  );
  let utcTime = targetLocalTime;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(utcTime))
        .filter(({ type }) => type !== "literal")
        .map(({ type, value }) => [type, Number(value)])
    );
    const displayedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute
    );
    utcTime = targetLocalTime - (displayedAsUtc - utcTime);
  }

  return new Date(utcTime).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function dateForIcs(date) {
  return date.replaceAll("-", "");
}

function createUid() {
  const id = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${id}@text-to-appointments.local`;
}

export function createIcs(group, titleTemplate, reminders = REMINDER_OPTIONS) {
  const summary = formatEventTitle(titleTemplate, group);
  const description = [
    `Bitte folgende Medien zurückgeben (${group.location}):`,
    ...group.items.map((item) => `- ${item.title}`),
  ].join("\n");
  const date = dateForIcs(group.date);
  const endDate = nextDate(group.date);
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Text to Appointments//Medienrueckgabe//DE",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-TIMEZONE:Europe/Berlin",
    "BEGIN:VEVENT",
    `UID:${createUid()}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
    `DTSTART;VALUE=DATE:${date}`,
    `DTEND;VALUE=DATE:${endDate}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(group.location)}`,
    ...reminders.flatMap(({ daysBefore, time }) => [
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `TRIGGER;VALUE=DATE-TIME:${reminderDateTime(group.date, daysBefore, time)}`,
      `DESCRIPTION:${escapeIcsText(summary)}`,
      "END:VALARM",
    ]),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

export function fileNameForGroup(group) {
  const locationSlug = group.location
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `medienrueckgabe-${group.date}-${locationSlug || "bibliothek"}.ics`;
}

function setMessage(element, message, kind = "") {
  element.textContent = message;
  element.className = `message${kind ? ` ${kind}` : ""}`;
}

function formatDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "full",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function downloadIcs(group, template, reminders) {
  const blob = new Blob([createIcs(group, template, reminders)], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileNameForGroup(group);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function initializeApp() {
  const sourceText = document.querySelector("#source-text");
  const analyzeButton = document.querySelector("#analyze-button");
  const inputMessage = document.querySelector("#input-message");
  const resultsSection = document.querySelector("#results-section");
  const groupsList = document.querySelector("#groups-list");
  const mediaCount = document.querySelector("#media-count");
  const titleTemplate = document.querySelector("#title-template");
  const reminderInputs = document.querySelectorAll('input[name="reminders"]');
  const reminderTimeInputs = document.querySelectorAll("[data-reminder-for]");
  const selectAll = document.querySelector("#select-all");
  const selectionCount = document.querySelector("#selection-count");
  const downloadSelected = document.querySelector("#download-selected");
  const exportMessage = document.querySelector("#export-message");
  let groups = [];
  let selectedGroupIds = new Set();

  const reminderTimeFor = (reminderId) =>
    [...reminderTimeInputs].find((input) => input.dataset.reminderFor === reminderId)?.value ?? "";
  const selectedReminders = () => REMINDER_OPTIONS.flatMap((reminder) => {
    const input = [...reminderInputs].find((candidate) => candidate.value === reminder.id);
    return input?.checked ? [{ ...reminder, time: reminderTimeFor(reminder.id) }] : [];
  });
  const reminderTimesAreValid = () => [...reminderInputs].every((input) =>
    !input.checked || /^([01]\d|2[0-3]):([0-5]\d)$/.test(reminderTimeFor(input.value))
  );

  const renderGroups = () => {
    groupsList.replaceChildren();
    for (const group of groups) {
      const card = document.createElement("article");
      card.className = "group-card";

      const topline = document.createElement("div");
      topline.className = "group-topline";
      const label = document.createElement("label");
      label.className = "group-select";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selectedGroupIds.has(group.id);
      checkbox.setAttribute("aria-label", `Gruppe ${formatDate(group.date)}, ${group.location} auswählen`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedGroupIds.add(group.id);
        else selectedGroupIds.delete(group.id);
        updateSelection();
      });
      const labelText = document.createElement("span");
      const date = document.createElement("p");
      date.className = "group-date";
      date.textContent = formatDate(group.date);
      const location = document.createElement("p");
      location.className = "group-location";
      location.textContent = group.location;
      labelText.append(date, location);
      label.append(checkbox, labelText);

      const total = document.createElement("span");
      total.className = "group-total";
      total.textContent = `${group.items.length} ${group.items.length === 1 ? "Medium" : "Medien"}`;
      topline.append(label, total);

      const titlePreview = document.createElement("p");
      titlePreview.className = "group-title-preview";
      titlePreview.textContent = formatEventTitle(titleTemplate.value, group);

      const mediaList = document.createElement("ul");
      mediaList.className = "media-list";
      for (const item of group.items) {
        const entry = document.createElement("li");
        entry.textContent = item.title;
        mediaList.append(entry);
      }

      const downloadButton = document.createElement("button");
      downloadButton.className = "group-download";
      downloadButton.type = "button";
      downloadButton.textContent = "Diese Gruppe als .ics herunterladen";
      downloadButton.disabled = !titleTemplate.value.trim() || !reminderTimesAreValid();
      downloadButton.addEventListener("click", () => {
        downloadIcs(group, titleTemplate.value, selectedReminders());
        setMessage(exportMessage, `Kalenderdatei für ${formatDate(group.date)} wurde erstellt.`, "success");
      });

      card.append(topline, titlePreview, mediaList, downloadButton);
      groupsList.append(card);
    }
    updateSelection();
  };

  const updateSelection = () => {
    const selectedCount = selectedGroupIds.size;
    const hasTitleTemplate = Boolean(titleTemplate.value.trim());
    selectionCount.textContent = `${selectedCount} von ${groups.length} ausgewählt`;
    selectAll.checked = groups.length > 0 && selectedCount === groups.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < groups.length;
    downloadSelected.disabled = selectedCount === 0 || !hasTitleTemplate || !reminderTimesAreValid();
  };

  analyzeButton.addEventListener("click", () => {
    groups = parseMediaText(sourceText.value);
    selectedGroupIds = new Set(groups.map((group) => group.id));
    setMessage(exportMessage, "");
    resultsSection.hidden = groups.length === 0;
    if (!groups.length) {
      setMessage(inputMessage, "Keine Rückgabegruppen erkannt. Bitte prüfe, ob die Zeilen „Markieren“, Rückgabedatum, Standort und Medientitel enthalten.", "error");
      return;
    }
    const mediaTotal = groups.reduce((total, group) => total + group.items.length, 0);
    mediaCount.textContent = `${mediaTotal} ${mediaTotal === 1 ? "Medium" : "Medien"} · ${groups.length} ${groups.length === 1 ? "Gruppe" : "Gruppen"}`;
    setMessage(inputMessage, `${mediaTotal} ${mediaTotal === 1 ? "Medium" : "Medien"} in ${groups.length} ${groups.length === 1 ? "Gruppe" : "Gruppen"} erkannt.`, "success");
    renderGroups();
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  titleTemplate.addEventListener("input", () => {
    renderGroups();
    if (!titleTemplate.value.trim()) {
      setMessage(exportMessage, "Bitte gib eine Titelvorlage ein, bevor du Kalenderdateien herunterlädst.", "error");
    } else if (exportMessage.classList.contains("error")) {
      setMessage(exportMessage, "");
    }
  });
  const updateReminderSettings = () => {
    renderGroups();
    setMessage(
      exportMessage,
      reminderTimesAreValid()
        ? "Die ausgewählten Erinnerungen und Uhrzeiten werden in die Kalenderdateien übernommen."
        : "Bitte wähle für jede aktivierte Erinnerung eine gültige Uhrzeit.",
      reminderTimesAreValid() ? "" : "error"
    );
  };
  for (const input of [...reminderInputs, ...reminderTimeInputs]) {
    input.addEventListener("input", updateReminderSettings);
    input.addEventListener("change", updateReminderSettings);
  }
  selectAll.addEventListener("change", () => {
    selectedGroupIds = selectAll.checked
      ? new Set(groups.map((group) => group.id))
      : new Set();
    renderGroups();
  });
  downloadSelected.addEventListener("click", () => {
    const selectedGroups = groups.filter((group) => selectedGroupIds.has(group.id));
    const reminders = selectedReminders();
    for (const group of selectedGroups) downloadIcs(group, titleTemplate.value, reminders);
    setMessage(
      exportMessage,
      `${selectedGroups.length} ${selectedGroups.length === 1 ? "Kalenderdatei wurde" : "Kalenderdateien wurden"} erstellt. Falls mehrere Downloads blockiert werden, erlaube sie für diese Seite oder lade die Gruppen einzeln herunter.`,
      "success"
    );
  });
}

if (typeof document !== "undefined") {
  initializeApp();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register(new URL("./sw.js", import.meta.url))
        .catch((error) => console.error("Service worker registration failed.", error));
    }, { once: true });
  }
}
