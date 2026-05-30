# PGN-Varianten-Brett

Eine statische, komplett offline laufende HTML-Seite zum Durchspielen von Schach-PGNs,
bei der **alle Varianten einer Stellung gleichzeitig** als nummerierte Pfeile aufs Brett
gezeichnet werden und die zugehörigen **Kommentare groß nebeneinander** rechts stehen.

## Benutzen
**Online:** per GitHub Pages direkt im Browser (sobald in den Repo-Settings aktiviert):
<https://kechel.github.io/pgn-varianten/>

**Lokal:** einfach **`index.html` im Browser öffnen** (Doppelklick). Kein Server nötig.

- Oben **„PGN öffnen…"** klicken oder eine `.pgn` ins Fenster ziehen.
- Enthält die Datei mehrere Partien, oben im Dropdown wählen.
- Jede mögliche Fortsetzung der aktuellen Stellung wird als **nummerierter Pfeil**
  gezeichnet (Hauptlinie grün = 1), rechts steht zu jeder Variante der PGN-Kommentar.
- **Folgen:** Karte / Pfeil anklicken oder Taste `1`–`9`.
- **Navigation:** `←` zurück · `→` Hauptlinie · `Home` Start · Breadcrumb unten anklicken.
- **Figuren mit der Maus ziehen** geht auch — passt der Zug zu einer Variante, wird ihr
  gefolgt; sonst frei weiterspielen (außerhalb der PGN).
- **„Drehen"** (`f`) dreht das Brett, **„Autoren-Pfeile"** blendet die in der PGN
  hinterlegten `[%cal]`/`[%csl]`-Markierungen des Autors ein/aus.

## Technik
- Brett: [chessground](https://github.com/lichess-org/chessground) (Lichess' Brett-Komponente)
  — native Pfeile/Markierungen + Drag, Figuren (cburnett) als data-URI eingebettet.
- Zug-Logik / SAN→Felder / Legalität: [chess.js](https://github.com/jhlywa/chess.js).
- Eigener PGN-Parser (`_build/src/pgn.js`): zerlegt verschachtelte Varianten, Kommentare,
  NAGs ($1…) und `%cal`/`%csl` in einen Zugbaum.
- Beides ist mit esbuild zu `dist/app.js` + `dist/app.css` gebündelt → keine externen
  Abhängigkeiten zur Laufzeit, läuft per `file://` ohne Internet.

## Neu bauen (nur falls Code geändert wird)
```sh
cd _build
npm install        # einmalig
node build.mjs     # -> ../dist/app.js + app.css
# node build.mjs --watch   # automatisch neu bauen
```
`dist/` ist absichtlich mit eingecheckt, damit das Tool ohne Build-Schritt läuft
und GitHub Pages es ausliefern kann.

## Lizenz
**GPL-3.0-or-later** © 2026 Jan Kechel — siehe [`LICENSE`](LICENSE).

Diese Lizenz ist zwingend, weil das ausgelieferte Bundle **chessground** (GPL-3.0)
enthält. Mitgelieferte Drittkomponenten und ihre Lizenzen sind in
[`CREDITS.md`](CREDITS.md) aufgeführt (chessground GPL-3.0, cburnett-Figuren GPL,
chess.js BSD-2-Clause; Build-Werkzeuge esbuild/MIT und puppeteer/Apache-2.0 sind
nicht im Bundle).
