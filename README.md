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

## GitHub Pages

Der Workflow in `.github/workflows/pages.yml` veröffentlicht die statische Anwendung nach Pushes auf `main`. Für den Rollback auf diese vorherige Version werden ausschließlich `index.html`, `app.js` und `styles.css` veröffentlicht.
