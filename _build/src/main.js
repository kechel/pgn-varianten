// SPDX-License-Identifier: GPL-3.0-or-later
// PGN-Varianten-Brett — Copyright (C) 2026 Jan Kechel
// Bundles chessground (GPL-3.0-or-later) and chess.js (BSD-2-Clause); see CREDITS.md.
import { Chessground } from 'chessground';
import { Chess } from 'chess.js';
import { splitGames, parseGame, parseComment, nagGlyph } from './pgn.js';

import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';

// ------------------------------------------------------------------
// distinct colours for the numbered variation arrows + matching cards
// ------------------------------------------------------------------
const PALETTE = [
  '#2e7d32', // 1 green
  '#1565c0', // 2 blue
  '#c62828', // 3 red
  '#e65100', // 4 orange
  '#6a1b9a', // 5 purple
  '#ad1457', // 6 pink
  '#00838f', // 7 teal
  '#9e9d24', // 8 olive
  '#4527a0', // 9 indigo
  '#5d4037', // 10 brown
  '#37474f', // 11 slate
  '#d84315', // 12 deep orange
];
function paletteColor(i) { return PALETTE[i % PALETTE.length]; }

// 'v<i>' = active arrow (full opacity), 'vf<i>' = inactive arrow (faded)
const variationBrushes = {};
const INACTIVE_OPACITY = 0.5;
PALETTE.forEach((color, i) => {
  variationBrushes['v' + i] = { key: 'v' + i, color, opacity: 1, lineWidth: 11 };
  variationBrushes['vf' + i] = { key: 'vf' + i, color, opacity: INACTIVE_OPACITY, lineWidth: 11 };
});
// faint brushes for the author's own [%cal] annotation arrows
const authorBrushes = {
  agreen: { key: 'agreen', color: '#2e7d32', opacity: 0.5, lineWidth: 8 },
  ared: { key: 'ared', color: '#c62828', opacity: 0.5, lineWidth: 8 },
  ablue: { key: 'ablue', color: '#1565c0', opacity: 0.5, lineWidth: 8 },
  ayellow: { key: 'ayellow', color: '#e0a800', opacity: 0.5, lineWidth: 8 },
};
const authorBrushOf = { green: 'agreen', red: 'ared', blue: 'ablue', yellow: 'ayellow' };
// the engine's best move — a THIN, DASHED arrow in a colour reserved only for
// the engine (magenta, used by no variation/author brush). Stays readable even
// when it overlaps the thick numbered variation arrows. The dashes are applied
// via CSS targeting this exact stroke colour (see ENGINE_ARROW_COLOR in style.css).
const ENGINE_ARROW_COLOR = '#d500f9';
const engineBrushes = { engine: { key: 'engine', color: ENGINE_ARROW_COLOR, opacity: 1, lineWidth: 5 } };

// ------------------------------------------------------------------
// global state
// ------------------------------------------------------------------
let ground = null;
let games = [];          // parsed games for the current file
let parsed = null;       // { root, startFen, ... } for the selected game
let path = [];           // array of nodes from root -> current (root included)
let orientation = 'white';
let showAuthor = true;
let selectedIndex = 0;   // keyboard-selected variation at the current node
let cardEls = [];        // card DOM elements, parallel to current().children

// --- local Stockfish (lazy-loaded from dist/engine.js only when turned on) ---
let engine = null;        // { send, onLine, quit } once the engine bundle is loaded
let engineOn = false;     // toggle state
let engineReady = false;  // UCI handshake finished
let enginePromise = null; // in-flight load, so we never inject the script twice
let engineBest = null;    // { from, to, fen } — best move arrow for the current position
let searchingFen = null;  // fen the engine is currently searching (null = idle)
let pendingFen = null;     // latest fen we still want searched once the engine is free
const ENGINE_DEPTH = 18;

// ------------------------------------------------------------------
// DOM
// ------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const boardEl = el('board');
const cardsEl = el('cards');
const headerCommentEl = el('headerComment');
const breadcrumbEl = el('breadcrumb');
const gameSelect = el('gameSelect');
const fileInput = el('fileInput');
const positionInfoEl = el('positionInfo');
const cardsChaptersEl = el('cardsChapters');
const engineToggle = el('chkEngine');
const qualleToggle = el('chkQualle');
const engineBarEl = el('engineBar');
const evalBarEl = el('evalBar');
const evalFillEl = el('evalFill');

function current() { return path[path.length - 1]; }

// ------------------------------------------------------------------
// board helpers
// ------------------------------------------------------------------
function legalDests(fen) {
  const chess = new Chess(fen);
  const dests = new Map();
  for (const m of chess.moves({ verbose: true })) {
    if (!dests.has(m.from)) dests.set(m.from, []);
    dests.get(m.from).push(m.to);
  }
  return dests;
}

function turnColor(fen) {
  return fen.split(' ')[1] === 'w' ? 'white' : 'black';
}

// the currently highlighted variation — driven ONLY by keyboard selection.
// The mouse never changes it (no hover); only a click navigates into a line.
function activeIndex() {
  const n = current().children.length;
  return Math.min(selectedIndex, Math.max(0, n - 1));
}

function buildAutoShapes() {
  const node = current();
  const shapes = [];
  // numbered arrows for every candidate continuation
  const active = activeIndex();
  node.children.forEach((child, i) => {
    const hot = i === active;
    const pi = i % PALETTE.length;
    shapes.push({
      orig: child.from,
      dest: child.to,
      brush: hot ? 'v' + pi : 'vf' + pi, // active = opacity 1, others faded
      modifiers: { lineWidth: hot ? 16 : 11, hilite: hot },
      label: { text: String(i + 1) },
    });
  });
  // the author's own annotation arrows/highlights for the reached position
  if (showAuthor) {
    for (const c of (node.csl || [])) shapes.push({ orig: c.orig, brush: authorBrushOf[c.brush] || 'agreen' });
    for (const a of (node.cal || [])) shapes.push({ orig: a.orig, dest: a.dest, brush: authorBrushOf[a.brush] || 'agreen' });
  }
  // the engine's best move for exactly this position
  if (engineOn && engineBest && engineBest.fen === node.fen) {
    shapes.push({ orig: engineBest.from, dest: engineBest.to, brush: 'engine' });
  }
  return shapes;
}

// (re)draw all board arrows. chessground's syncShapes only appends new shapes
// and never reorders existing ones, so e.g. changing the selected variation
// re-appends those arrows on TOP of an unchanged engine arrow. After every
// update we therefore lift the engine arrow back to the end of the SVG so it
// always stays above the variation arrows.
function setShapes() {
  ground.setAutoShapes(buildAutoShapes());
  // chessground renders shapes asynchronously (debounced via requestAnimationFrame),
  // so raise the engine arrow on the next frame, AFTER the new SVG is in the DOM.
  requestAnimationFrame(raiseEngineArrow);
}

function raiseEngineArrow() {
  const line = boardEl.querySelector('.cg-shapes line[stroke="' + ENGINE_ARROW_COLOR + '"]');
  if (!line) return;
  const grp = line.closest('g[cgHash]');
  const parent = grp && grp.parentElement;
  if (parent && grp !== parent.lastElementChild) parent.appendChild(grp);
}

function refreshBoard() {
  const node = current();
  ground.set({
    fen: node.fen,
    turnColor: turnColor(node.fen),
    lastMove: node.from ? [node.from, node.to] : undefined,
    movable: { color: turnColor(node.fen), dests: legalDests(node.fen), free: false },
  });
  setShapes();
}

// ------------------------------------------------------------------
// rendering the right-hand panel
// ------------------------------------------------------------------
function moveText(node) {
  return node.moveNumber + ' ' + node.san + node.nags.map(nagGlyph).join('');
}

function chapterName(i) {
  const ch = parsed && parsed.chapters.find((c) => c.idx === i);
  return ch ? ch.title : 'Kapitel ' + (i + 1);
}

// does the current-line (non-transposed) part span more than one chapter?
function ownMulti(comments) {
  return new Set(comments.filter((c) => !c.transposed).map((c) => c.chapter)).size > 1;
}
// chip in front of a comment: transposition notes always marked, own notes
// labelled by chapter only when several chapters share this exact line
function commentTag(c, multi) {
  if (c.transposed) return '<span class="hc-src hc-transp">↺ Zugumstellung · ' + escapeHtml(chapterName(c.chapter)) + '</span> ';
  if (multi) return '<span class="hc-src">' + escapeHtml(chapterName(c.chapter)) + '</span> ';
  return '';
}
function commentsHtml(comments, multi) {
  return comments.map((c) =>
    '<div class="hc-text' + (c.transposed ? ' hc-text-transp' : '') + '">' +
    commentTag(c, multi) + escapeHtml(c.text) + '</div>'
  ).join('');
}

function renderHeaderComment() {
  const node = current();
  if (node.san) {
    const comments = node.allComments || node.comments || [];
    const multi = ownMulti(comments);
    headerCommentEl.innerHTML =
      '<div class="hc-move">' + escapeHtml(moveText(node)) +
      (node.offBook ? ' <span class="hc-src">außerhalb der PGN</span>' : '') + '</div>' +
      commentsHtml(comments, multi);
    headerCommentEl.style.display = '';
  } else {
    headerCommentEl.innerHTML = '<div class="hc-move">Startstellung</div>';
    headerCommentEl.style.display = '';
  }
}

function renderCards() {
  const node = current();
  cardsEl.innerHTML = '';
  cardEls = [];
  if (node.children.length === 0) {
    const end = document.createElement('div');
    end.className = 'card card-end';
    end.textContent = 'Ende dieser Linie — keine weiteren Züge in der PGN.';
    cardsEl.appendChild(end);
    return;
  }
  node.children.forEach((child, i) => {
    const color = paletteColor(i);
    const card = document.createElement('div');
    card.className = 'card' + (i === 0 ? ' card-main' : '');
    card.style.setProperty('--accent', color);

    const head = document.createElement('div');
    head.className = 'card-head';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.style.background = color;
    badge.textContent = String(i + 1);
    const mv = document.createElement('span');
    mv.className = 'card-move';
    mv.textContent = moveText(child);
    head.appendChild(badge);
    head.appendChild(mv);
    if (i === 0) {
      const tag = document.createElement('span');
      tag.className = 'card-tag';
      tag.textContent = 'Hauptlinie';
      head.appendChild(tag);
    }
    // chapter(s) of this variation, right next to the move
    const headSrcs = child.posSources || child.sources || [];
    if (headSrcs.length) {
      const chap = document.createElement('span');
      chap.className = 'card-chap';
      if (headSrcs.length === 1) {
        chap.textContent = chapterName(headSrcs[0]);
      } else {
        chap.textContent = headSrcs.length + ' Kapitel';
        chap.title = headSrcs.map(chapterName).join(', ');
      }
      head.appendChild(chap);
    }
    if (child.children.length > 0) {
      const cont = document.createElement('span');
      cont.className = 'card-cont';
      cont.textContent = '→ ' + child.children.length + ' Forts.';
      head.appendChild(cont);
    }
    card.appendChild(head);

    const comments = child.allComments || child.comments || [];
    const multi = ownMulti(comments);
    if (comments.length) {
      const body = document.createElement('div');
      body.className = 'card-body';
      body.innerHTML = comments.map((c) =>
        '<span class="card-line' + (c.transposed ? ' card-line-transp' : '') + '">' +
        commentTag(c, multi) + escapeHtml(c.text) + '</span>'
      ).join('<br>');
      card.appendChild(body);
    } else {
      const body = document.createElement('div');
      body.className = 'card-body card-body-empty';
      body.textContent = '(kein Kommentar)';
      card.appendChild(body);
    }

    card.addEventListener('click', () => goTo(child)); // mouse only acts on click
    cardEls.push(card);
    cardsEl.appendChild(card);
  });
  applySelection();
}

// highlight the selected variation (card box + board arrow) from one index
function applySelection() {
  const active = activeIndex();
  cardEls.forEach((c, i) => c.classList.toggle('card-selected', i === active));
  setShapes();
}

function moveSelection(delta) {
  const n = current().children.length;
  if (n <= 1) return;
  selectedIndex = (selectedIndex + delta + n) % n;
  applySelection();
  const c = cardEls[selectedIndex];
  if (c) c.scrollIntoView({ block: 'nearest' });
}

function renderBreadcrumb() {
  breadcrumbEl.innerHTML = '';
  path.forEach((node, idx) => {
    const span = document.createElement('span');
    span.className = 'crumb' + (idx === path.length - 1 ? ' crumb-current' : '');
    span.textContent = node.san ? node.san : 'Start';
    span.addEventListener('click', () => { path = path.slice(0, idx + 1); renderAll(); });
    breadcrumbEl.appendChild(span);
    if (idx < path.length - 1) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›';
      breadcrumbEl.appendChild(sep);
    }
  });
  const node = current();
  positionInfoEl.textContent = node.children.length + ' Variante' + (node.children.length === 1 ? '' : 'n');
  // keep the current move visible when the list wraps to several lines
  const cur = breadcrumbEl.querySelector('.crumb-current');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

// show the chapter(s) the current line belongs to, next to the cards heading
function renderChapterInfo() {
  if (!cardsChaptersEl) return;
  const node = current();
  let idxs;
  if (!node.san) idxs = parsed ? parsed.chapters.map((c) => c.idx) : []; // start = all
  else idxs = (node.sources || []).slice();
  idxs.sort((a, b) => a - b);
  if (!idxs.length) { cardsChaptersEl.innerHTML = ''; return; }
  const names = idxs.map(chapterName);
  if (names.length <= 3) {
    cardsChaptersEl.innerHTML = '<span class="chap-label">Kapitel</span>' +
      names.map((nm) => '<span class="chap-chip">' + escapeHtml(nm) + '</span>').join('');
  } else {
    cardsChaptersEl.innerHTML =
      '<span class="chap-chip" title="' + escapeHtml(names.join(', ')) + '">' + names.length + ' Kapitel</span>';
  }
}

function renderAll() {
  selectedIndex = 0;
  refreshBoard();
  renderHeaderComment();
  renderCards();
  renderBreadcrumb();
  renderChapterInfo();
  if (engineOn && engineReady) analyze();
}

// ------------------------------------------------------------------
// local Stockfish — load on demand, then evaluate the current position
// ------------------------------------------------------------------
// inject dist/engine.js once (a plain <script> works over file://, unlike
// fetch/XHR/Worker-from-file). It exposes window.PgnEngine.
function loadEngineScript() {
  if (window.PgnEngine) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    const base = (document.querySelector('script[src$="app.js"]') || {}).src || '';
    s.src = base ? base.replace(/app\.js(\?.*)?$/, 'engine.js') : 'dist/engine.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('engine.js konnte nicht geladen werden'));
    document.head.appendChild(s);
  });
}

function ensureEngine() {
  if (engineReady) return Promise.resolve();
  if (enginePromise) return enginePromise;
  enginePromise = loadEngineScript().then(() => new Promise((resolve) => {
    engine = window.PgnEngine.load();
    engine.onLine((line) => {
      if (!engineReady && (line === 'uciok' || /^id /.test(line))) { /* handshake progressing */ }
      if (line === 'readyok') { engineReady = true; resolve(); }
      onEngineLine(line);
    });
    engine.send('uci');
    engine.send('setoption name MultiPV value 1');
    engine.send('ucinewgame');
    engine.send('isready');
  }));
  return enginePromise;
}

// convert a UCI principal variation (e2e4 e7e5 …) into SAN, from the given FEN
function uciLineToSan(fen, uciMoves, max) {
  const chess = new Chess(fen);
  const out = [];
  for (const u of uciMoves) {
    if (out.length >= max) break;
    const mv = { from: u.slice(0, 2), to: u.slice(2, 4) };
    if (u.length > 4) mv.promotion = u[4];
    let r;
    try { r = chess.move(mv); } catch (e) { break; }
    if (!r) break;
    out.push(r.san);
  }
  return out;
}

function onEngineLine(line) {
  // search finished (or was stopped) — the engine is now free; start the next
  // position if navigation queued one. NEVER send position/go mid-search: the
  // single-threaded wasm traps ("unreachable") on a position change while busy.
  // Handle this even when the engine is toggled off, so the busy state always
  // clears and a later toggle-on can't start a search while one is still live.
  if (line.lastIndexOf('bestmove', 0) === 0) { searchingFen = null; pumpEngine(); return; }
  if (!engineOn || searchingFen === null || !path.length) return;
  const fen = searchingFen;
  // only paint the board if this result is still for the position on the board
  if (fen !== current().fen) return;
  // a depth/score/pv info line
  if (line.lastIndexOf('info', 0) === 0 && line.indexOf(' pv ') !== -1) {
    const depthM = line.match(/\bdepth (\d+)/);
    const cpM = line.match(/\bscore cp (-?\d+)/);
    const mateM = line.match(/\bscore mate (-?\d+)/);
    const pvM = line.match(/ pv (.+)$/);
    if (!pvM) return;
    const pv = pvM[1].trim().split(/\s+/);
    engineBest = { from: pv[0].slice(0, 2), to: pv[0].slice(2, 4), promotion: pv[0].slice(4) || null, fen };
    const whiteToMove = turnColor(fen) === 'white';
    let scoreText, cpForBar;
    if (mateM) {
      const m = parseInt(mateM[1], 10);
      const signed = whiteToMove ? m : -m;
      scoreText = '#' + (signed < 0 ? '-' : '') + Math.abs(m);
      cpForBar = signed >= 0 ? 100000 : -100000;
    } else if (cpM) {
      let cp = parseInt(cpM[1], 10);
      if (!whiteToMove) cp = -cp; // make it White-relative
      cpForBar = cp;
      const p = (cp / 100).toFixed(2);
      scoreText = (cp > 0 ? '+' : '') + p;
    } else {
      return;
    }
    updateEngineBar(scoreText, depthM ? parseInt(depthM[1], 10) : null,
      uciLineToSan(fen, pv, 8), cpForBar);
    setShapes();
  }
}

// eval bar fill: logistic-ish squash of centipawns into 0..100 % (White at bottom)
function evalToPercent(cp) {
  if (cp >= 100000) return 100;
  if (cp <= -100000) return 0;
  const x = Math.max(-1500, Math.min(1500, cp)) / 1000;
  return 50 + 50 * (2 / (1 + Math.exp(-1.4 * x)) - 1);
}

function updateEngineBar(scoreText, depth, pvSan, cpForBar) {
  if (evalFillEl) evalFillEl.style.height = evalToPercent(cpForBar).toFixed(1) + '%';
  if (!engineBarEl) return;
  const cls = scoreText.indexOf('-') === 0 || (scoreText[0] !== '+' && scoreText[0] !== '#') ? 'eval-neg' : 'eval-pos';
  engineBarEl.innerHTML =
    '<span class="eval-score ' + cls + '">' + escapeHtml(scoreText) + '</span>' +
    (depth != null ? '<span class="eval-meta">Tiefe ' + depth + '</span>' : '') +
    '<span class="eval-pv">' + escapeHtml(pvSan.join(' ')) + (pvSan.length >= 8 ? ' …' : '') + '</span>';
}

// Serialize engine work: at most one search runs at a time. analyze() records
// the wanted position; pumpEngine() either starts it (engine idle) or stops the
// running search and lets the bestmove handler start the latest wanted one.
function analyze() {
  if (!engineOn || !engineReady || !engine || !path.length) return;
  pendingFen = current().fen;
  pumpEngine();
}

function pumpEngine() {
  if (!engineOn || !engineReady || !engine) return;
  if (searchingFen !== null) { engine.send('stop'); return; } // bestmove will re-pump
  if (pendingFen !== null) {
    searchingFen = pendingFen;
    pendingFen = null;
    engineBest = null; // drop the previous position's arrow until new info arrives
    engine.send('position fen ' + searchingFen);
    engine.send('go depth ' + ENGINE_DEPTH);
  }
}

async function setEngineOn(on) {
  engineOn = on;
  if (on) {
    if (evalBarEl) evalBarEl.classList.add('on'); // visibility only — never shifts the board
    if (engineBarEl) { engineBarEl.style.display = ''; engineBarEl.innerHTML = '<span class="eval-meta">Engine wird geladen…</span>'; }
    try {
      await ensureEngine();
    } catch (e) {
      console.warn(e);
      if (engineBarEl) engineBarEl.innerHTML = '<span class="eval-neg">Engine konnte nicht geladen werden.</span>';
      engineOn = false; engineToggle.checked = false;
      if (evalBarEl) evalBarEl.classList.remove('on');
      return;
    }
    if (!engineOn) return; // toggled back off while loading
    analyze();
  } else {
    if (engine) engine.send('stop'); // searchingFen is cleared by the bestmove that follows
    engineBest = null; pendingFen = null;
    if (evalBarEl) evalBarEl.classList.remove('on');
    if (engineBarEl) engineBarEl.style.display = 'none';
    setShapes();
  }
}

// ------------------------------------------------------------------
// navigation
// ------------------------------------------------------------------
function goTo(node) { path.push(node); renderAll(); }
function goBack() {
  if (path.length <= 1) return;
  const cameFrom = path.pop();
  renderAll();
  // re-select the variation we just came from, so ArrowRight returns to it
  const idx = current().children.indexOf(cameFrom);
  if (idx >= 0) {
    selectedIndex = idx;
    applySelection();
    const c = cardEls[idx];
    if (c) c.scrollIntoView({ block: 'nearest' });
  }
}
function goReset() { path = [parsed.root]; renderAll(); }

// drag-and-drop move on the board
function onBoardMove(orig, dest) {
  const node = current();
  // does this match a candidate continuation?
  const child = node.children.find((c) => c.from === orig && c.to === dest);
  if (child) { goTo(child); return; }
  // otherwise allow free (off-book) exploration if the move is legal
  playOffBook(orig, dest, 'q');
}

// play a legal move that isn't (or no longer is) in the PGN — creates an ad-hoc
// node and navigates into it. Used for board drags and for following the engine
// recommendation at the end of a line.
function playOffBook(orig, dest, promotion) {
  const node = current();
  const chess = new Chess(node.fen);
  let mv;
  try { mv = chess.move({ from: orig, to: dest, promotion: promotion || 'q' }); }
  catch (e) { renderAll(); return; }
  if (!mv) { renderAll(); return; }
  const adhoc = {
    san: mv.san, from: mv.from, to: mv.to, promotion: mv.promotion || null,
    fenBefore: node.fen, fen: chess.fen(), color: mv.color,
    moveNumber: (node.fen.split(' ')[5] || '1') + (mv.color === 'w' ? '.' : '...'),
    nags: [], comments: [], cal: [], csl: [], sources: [], children: [],
    offBook: true,
  };
  goTo(adhoc);
}

// ------------------------------------------------------------------
// merging all chapters (games) of a file into one shared move tree
// ------------------------------------------------------------------
function chapterTitle(g, idx) {
  const parts = [...new Set([g.tags.White, g.tags.Black].filter((x) => x && x !== '?'))];
  return parts.join(' / ') || ('Kapitel ' + (idx + 1));
}

// position identity = piece placement + side to move + castling + en passant
// (the first 4 FEN fields; move counters are irrelevant to "same position")
function fenKey(fen) { return fen ? fen.split(' ').slice(0, 4).join(' ') : ''; }

// Two nodes are "the same" only when they are the same move AND land on an
// EXACTLY identical position. The fen check makes the merge invariant explicit:
// lines are never fused just because their last move happened to coincide.
function sameMove(a, b) {
  return a.from === b.from && a.to === b.to &&
    (a.promotion || null) === (b.promotion || null) &&
    fenKey(a.fen) === fenKey(b.fen);
}

function mergeInto(tgtParent, srcParent, cidx) {
  for (const s of srcParent.children) {
    let t = tgtParent.children.find((c) => sameMove(c, s));
    if (!t) {
      t = {
        san: s.san, from: s.from, to: s.to, promotion: s.promotion || null,
        fenBefore: s.fenBefore, fen: s.fen, color: s.color, moveNumber: s.moveNumber,
        nags: [], comments: [], cal: [], csl: [], sources: [], children: [],
      };
      tgtParent.children.push(t);
    }
    for (const ng of s.nags) if (!t.nags.includes(ng)) t.nags.push(ng);
    if (!t.sources.includes(cidx)) t.sources.push(cidx);
    const raw = [s.commentBefore, s.commentRaw].filter(Boolean).join(' ');
    if (raw) {
      const pc = parseComment(raw);
      if (pc.text && !t.comments.some((c) => c.text === pc.text)) t.comments.push({ chapter: cidx, text: pc.text });
      for (const a of pc.cal) if (!t.cal.some((x) => x.orig === a.orig && x.dest === a.dest && x.brush === a.brush)) t.cal.push(a);
      for (const a of pc.csl) if (!t.csl.some((x) => x.orig === a.orig && x.brush === a.brush)) t.csl.push(a);
    }
    mergeInto(t, s, cidx);
  }
}

function mainlineMoves(root) {
  const out = [];
  let n = root;
  while (n.children.length) { n = n.children[0]; out.push(n); }
  return out;
}

// jump target: the first node on this chapter's mainline that belongs to this
// chapter alone (its characteristic move). Falls back to the deepest least-shared node.
function chapterJump(root, sans) {
  const path = [root];
  let node = root, best = null, bestSize = Infinity;
  for (const mv of sans) {
    const child = node.children.find((c) => sameMove(c, mv));
    if (!child) break;
    path.push(child); node = child;
    const size = (child.mainOf || []).length;
    if (size === 1) return path.slice();
    if (size <= bestSize) { bestSize = size; best = path.length; }
  }
  return best ? path.slice(0, best) : path;
}

function buildMerged(games) {
  const list = games.map((g, idx) => ({ idx, title: chapterTitle(g, idx), parsed: parseGame(g) }));
  const startFen = list[0].parsed.startFen;
  const root = { san: null, from: null, to: null, fen: startFen, moveNumber: '', nags: [], comments: [], cal: [], csl: [], sources: [], children: [], mainOf: [] };
  let errors = [];
  for (const pg of list) { mergeInto(root, pg.parsed.root, pg.idx); errors = errors.concat(pg.parsed.errors); }
  // tag each node with the chapters whose *mainline* runs through it
  for (const pg of list) {
    let node = root;
    for (const mv of mainlineMoves(pg.parsed.root)) {
      const child = node.children.find((c) => sameMove(c, mv));
      if (!child) break;
      (child.mainOf || (child.mainOf = [])).push(pg.idx);
      node = child;
    }
  }
  // Transposition-aware descriptions: gather, per RESULTING position (fenKey),
  // every distinct comment and every chapter that reaches it — regardless of the
  // move order / origin square used to get there. So a position reached from two
  // different lines shows BOTH chapters' notes side by side.
  const commentsByPos = new Map(); // fenKey -> [{chapter,text}]
  const chaptersByPos = new Map(); // fenKey -> Set(chapter)
  (function index(node) {
    if (node.san) {
      const k = fenKey(node.fen);
      let arr = commentsByPos.get(k); if (!arr) commentsByPos.set(k, arr = []);
      for (const c of node.comments) if (!arr.some((x) => x.text === c.text)) arr.push(c);
      let s = chaptersByPos.get(k); if (!s) chaptersByPos.set(k, s = new Set());
      for (const ch of node.sources) s.add(ch);
    }
    for (const c of node.children) index(c);
  })(root);
  (function assign(node) {
    if (node.san) {
      const k = fenKey(node.fen);
      const own = node.comments || [];
      const rest = (commentsByPos.get(k) || []).filter((c) => !own.some((o) => o.text === c.text));
      // own line first (priority), then transposition notes flagged as such
      node.allComments = own.map((c) => ({ chapter: c.chapter, text: c.text, transposed: false }))
        .concat(rest.map((c) => ({ chapter: c.chapter, text: c.text, transposed: true })));
      node.posSources = [...(chaptersByPos.get(k) || [])].sort((a, b) => a - b);
    }
    for (const c of node.children) assign(c);
  })(root);
  const chapters = list.map((pg) => ({ idx: pg.idx, title: pg.title, path: chapterJump(root, mainlineMoves(pg.parsed.root)) }));
  return { root, startFen, chapters, errors };
}

// ------------------------------------------------------------------
// loading files / chapters
// ------------------------------------------------------------------
function loadFile(text, name) {
  games = splitGames(text);
  gameSelect.innerHTML = '';
  if (games.length === 0) {
    alert('Keine Partie in dieser Datei gefunden.');
    return;
  }
  parsed = buildMerged(games);
  const ph = document.createElement('option');
  ph.value = '-1';
  ph.textContent = games.length > 1 ? '⤓ Kapitel anspringen… (' + games.length + ')' : chapterTitle(games[0], 0);
  gameSelect.appendChild(ph);
  parsed.chapters.forEach((ch) => {
    const opt = document.createElement('option');
    opt.value = String(ch.idx);
    opt.textContent = (ch.idx + 1) + '. ' + ch.title;
    gameSelect.appendChild(opt);
  });
  gameSelect.disabled = games.length < 2;
  el('fileName').textContent = name || '';
  path = [parsed.root];
  gameSelect.value = '-1';
  renderAll();
  if (parsed.errors.length) console.warn('PGN: konnte einige Züge nicht parsen:', parsed.errors);
}

function jumpToChapter(i) {
  if (i < 0) return;
  const ch = parsed.chapters.find((c) => c.idx === i);
  if (!ch) return;
  path = ch.path.slice();
  renderAll();
  gameSelect.value = '-1'; // dropdown acts as a one-shot jump control
}

// ------------------------------------------------------------------
// utilities
// ------------------------------------------------------------------
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ------------------------------------------------------------------
// init
// ------------------------------------------------------------------
function init() {
  ground = Chessground(boardEl, {
    orientation,
    coordinates: true,
    movable: { free: false, color: 'white', dests: new Map(), showDests: true, events: { after: onBoardMove } },
    draggable: { enabled: true, showGhost: true },
    drawable: {
      enabled: true,
      visible: true,
      brushes: { ...defaultBrushes(), ...variationBrushes, ...authorBrushes, ...engineBrushes },
    },
    highlight: { lastMove: true, check: true },
    animation: { enabled: true, duration: 180 },
  });

  fileInput.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => loadFile(reader.result, f.name);
    reader.readAsText(f, 'UTF-8');
  });

  gameSelect.addEventListener('change', (e) => { jumpToChapter(parseInt(e.target.value, 10)); gameSelect.blur(); });
  el('btnBack').addEventListener('click', goBack);
  el('btnReset').addEventListener('click', goReset);
  el('btnFlip').addEventListener('click', () => {
    orientation = orientation === 'white' ? 'black' : 'white';
    ground.set({ orientation });
  });
  const authorToggle = el('chkAuthor');
  // blur after toggling so focus returns to the page and the keyboard (↑↓←→,
  // 1–9) keeps working — otherwise the focused checkbox/select swallows keys
  authorToggle.addEventListener('change', () => { showAuthor = authorToggle.checked; authorToggle.blur(); setShapes(); });

  if (engineToggle) {
    engineToggle.addEventListener('change', () => { engineToggle.blur(); setEngineOn(engineToggle.checked); });
    if (engineToggle.checked) setEngineOn(true); // default on → load + start evaluating
  }

  if (qualleToggle) {
    document.body.classList.toggle('qualle', qualleToggle.checked); // sync with default
    qualleToggle.addEventListener('change', () => { qualleToggle.blur(); document.body.classList.toggle('qualle', qualleToggle.checked); });
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft' || e.key === 'Backspace') { e.preventDefault(); goBack(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      const n = current();
      // follow the highlighted variation; if there are no variations left but the
      // engine has a recommendation for this position, play that move instead.
      if (n.children.length) goTo(n.children[activeIndex()]);
      else if (engineOn && engineBest && engineBest.fen === n.fen) {
        playOffBook(engineBest.from, engineBest.to, engineBest.promotion || 'q');
      }
    } else if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
    else if (/^[1-9]$/.test(e.key)) {
      const n = current();
      const idx = parseInt(e.key, 10) - 1;
      if (n.children[idx]) goTo(n.children[idx]);
    } else if (e.key === 'Home') { goReset(); }
    else if (e.key.toLowerCase() === 'f') { orientation = orientation === 'white' ? 'black' : 'white'; ground.set({ orientation }); }
  });

  // drag & drop a .pgn onto the window
  window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) document.body.classList.remove('dragging'); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => loadFile(reader.result, f.name);
    reader.readAsText(f, 'UTF-8');
  });

  window.addEventListener('resize', () => ground.redrawAll());
}

function defaultBrushes() {
  return {
    green: { key: 'g', color: '#15781B', opacity: 1, lineWidth: 10 },
    red: { key: 'r', color: '#882020', opacity: 1, lineWidth: 10 },
    blue: { key: 'b', color: '#003088', opacity: 1, lineWidth: 10 },
    yellow: { key: 'y', color: '#e68f00', opacity: 1, lineWidth: 10 },
  };
}

init();
