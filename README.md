# Medienrückgabe planen

Eine kleine, browserbasierte Anwendung, die Ausleihtext lokal auswertet und je Rückgabedatum und Bibliotheksstandort eine Kalenderdatei erstellt. Der eingefügte Text wird nicht an einen Server übertragen.

## Starten

Voraussetzung: Node.js 18 oder neuer.

```sh
npm start
```

Öffne anschließend <http://127.0.0.1:4173>. Zum Ausführen der Tests:

```sh
npm test
```

Die Anwendung erkennt Medienzeilen im Format des mitgelieferten `input_example_1.txt`. Die Beispieldatei enthält ausschließlich erfundene Standorte, Medien und Kennungen. Datumsangaben hinter „Stand“ sind Statusinformationen und werden nicht als Rückgabetermine verwendet. Kalenderdateien enthalten ganztägige Termine mit dem Abholstandort als Kalenderort. Standardmäßig erfolgen Erinnerungen zwei Tage vorher um 17:00, einen Tag vorher um 17:00 und am Rückgabetag um 07:00 deutscher Ortszeit. Uhrzeiten können geändert und Erinnerungen einzeln abgewählt werden.

## Als PWA installieren und offline verwenden

Die Seite kann über den Browser auf dem Smartphone zum Startbildschirm hinzugefügt werden. Lade sie zunächst einmal bei bestehender Internetverbindung, damit der App-Shell-Cache eingerichtet wird. Danach sind Oberfläche und Verarbeitung auch offline verfügbar. Der Service Worker speichert ausschließlich die statischen App-Dateien; eingefügter Ausleihtext und erzeugte Kalenderdateien werden nicht gespeichert oder übertragen. Wenn die Seite online erneut geladen wird, werden die App-Dateien aus dem Netzwerk aktualisiert und als Offline-Kopie gespeichert.

## Veröffentlichung mit GitHub Pages

Der Workflow in `.github/workflows/pages.yml` baut mit `npm run build` ein statisches Artefakt aus einer festen Liste von App-Dateien. Er veröffentlicht es bei Pushes nach `main` oder manuellem Start des Workflows. Zum Einrichten:

1. Lege ein öffentliches GitHub-Repository an und pushe den Projektstand auf den Branch `main`.
2. Öffne im Repository **Settings → Pages** und wähle unter **Build and deployment → Source** die Option **GitHub Actions**.
3. Prüfe unter **Actions**, dass **Deploy to GitHub Pages** erfolgreich war. Öffne anschließend die dort angezeigte Seiten-URL. GitHub Pages stellt die Seite über HTTPS bereit, das für Service Worker benötigt wird.

Die lokalen Entwicklungstests laufen mit `npm test`. `npm run build` erstellt beziehungsweise ersetzt den Pages-Inhalt in `dist/`. Das Artefakt enthält nur die freigegebenen HTML-, JavaScript-, CSS-, Manifest-, Service-Worker- und Icon-Dateien, nicht die Beispieldaten, Tests oder Repository-Konfiguration.

### Zurück zur bisherigen Version

Der bestehende Git-Commit bleibt in der Historie erhalten. Falls die veröffentlichte PWA Probleme verursacht, erstelle einen Revert des Commits, der die PWA-Änderungen eingeführt hat, und pushe ihn nach `main`:

```sh
git revert <commit-mit-den-PWA-aenderungen>
git push
```

Der Pages-Workflow veröffentlicht daraufhin wieder den vorherigen App-Stand. Die Git-Historie wird dabei nicht umgeschrieben.

### Sicherheitshinweise

Die Anwendung verarbeitet alle Eingaben lokal und hat keinen Server-Endpunkt für Ausleihdaten. Eine Content Security Policy beschränkt Ressourcen auf dieselbe Herkunft. GitHub Pages erlaubt diesem Projekt keine eigenen HTTP-Sicherheitsheader; deshalb kann die Anwendung dort keine Header wie `frame-ancestors` setzen. Der Workflow verwendet minimale GitHub-Permissions und veröffentlicht nur die benötigten statischen Dateien.
