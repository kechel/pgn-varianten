# Credits & Lizenzen der verwendeten Komponenten

Dieses Projekt (**PGN-Varianten-Brett**, © 2026 Jan Kechel) steht unter der
**GPL-3.0-or-later** — siehe [`LICENSE`](LICENSE). Diese Wahl ist zwingend, weil
das ausgelieferte Bundle *chessground* (GPL-3.0) enthält.

Im ausgelieferten Bundle (`dist/`) enthalten:

| Komponente | Copyright | Lizenz |
|---|---|---|
| [chessground](https://github.com/lichess-org/chessground) | © lichess.org (Thibault Duplessis u. a.) | **GPL-3.0-or-later** |
| cburnett-Schachfiguren (in `chessground.cburnett.css`) | © Colin M. L. Burnett | GPL (siehe unten) |
| [chess.js](https://github.com/jhlywa/chess.js) | © 2025 Jeff Hlywa | BSD-2-Clause |

Nur zur Entwicklung/zum Bauen verwendet (**nicht** im Bundle):

| Werkzeug | Lizenz |
|---|---|
| [esbuild](https://github.com/evanw/esbuild) | MIT |
| [puppeteer-core](https://github.com/puppeteer/puppeteer) | Apache-2.0 |

---

## chess.js — BSD-2-Clause (vollständig reproduziert)

```
Copyright (c) 2025, Jeff Hlywa (jhlywa@gmail.com)
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

## cburnett-Figuren

Die Schachfiguren-Grafiken (als data-URIs in `chessground.cburnett.css`) stammen von
Colin M. L. Burnett und werden von Lichess unter freien Lizenzen verbreitet
(GPL / GFDL / BSD; ursprünglich für Wikipedia erstellt). Sie werden hier unverändert
über chessground eingebunden. Quelle:
<https://github.com/lichess-org/lila/tree/master/public/piece/cburnett>

## chessground & GPL

> Chessground is distributed under the GPL-3.0 license (or any later version).
> When you use Chessground for your website, your combined work may be distributed
> only under the GPL. You must release your source code to the users of your website.

Deshalb ist der vollständige Quellcode dieses Projekts in diesem Repository veröffentlicht.
