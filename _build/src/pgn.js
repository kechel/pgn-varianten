// SPDX-License-Identifier: GPL-3.0-or-later
// PGN-Varianten-Brett — Copyright (C) 2026 Jan Kechel
//
// PGN parsing: split games, tokenize movetext, build a move tree with variations.
// Uses chess.js to derive from/to squares and FEN for every move.
import { Chess, DEFAULT_POSITION } from 'chess.js';

// ---------- split a multi-game PGN file into individual games ----------
export function splitGames(text) {
  // strip BOM
  text = text.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  const games = [];
  let cur = null;
  let sawMoves = false;
  const tagRe = /^\s*\[\s*(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/;
  for (const line of lines) {
    const m = line.match(tagRe);
    if (m) {
      if (cur === null || sawMoves) {
        cur = { tags: {}, movetext: [] };
        games.push(cur);
        sawMoves = false;
      }
      cur.tags[m[1]] = m[2];
    } else {
      if (cur === null) continue; // junk before first game
      cur.movetext.push(line);
      if (line.trim() !== '') sawMoves = true;
    }
  }
  return games.map((g) => ({ tags: g.tags, movetext: g.movetext.join('\n').trim() }));
}

// ---------- tokenize movetext ----------
function tokenize(s) {
  const toks = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '{') {
      const close = s.indexOf('}', i + 1);
      const end = close === -1 ? n : close;
      toks.push({ type: 'comment', text: s.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (c === ';') { // rest-of-line comment
      const nl = s.indexOf('\n', i);
      const end = nl === -1 ? n : nl;
      toks.push({ type: 'comment', text: s.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    if (c === '(') { toks.push({ type: 'open' }); i++; continue; }
    if (c === ')') { toks.push({ type: 'close' }); i++; continue; }
    if (c === '$') {
      let j = i + 1;
      while (j < n && /[0-9]/.test(s[j])) j++;
      toks.push({ type: 'nag', val: parseInt(s.slice(i + 1, j), 10) });
      i = j;
      continue;
    }
    // a "word": read until whitespace or a delimiter
    let j = i;
    while (j < n && !/[\s(){};]/.test(s[j])) j++;
    let word = s.slice(i, j);
    i = j;
    // peel trailing NAGs glued to the move ("Nc6$2")
    const nagMatch = word.match(/(\$\d+)+$/);
    if (nagMatch) {
      word = word.slice(0, word.length - nagMatch[0].length);
      for (const nm of nagMatch[0].match(/\$\d+/g)) toks.push({});
    }
    // strip leading move number ("4." / "4..." / "12.")
    word = word.replace(/^\d+\.(\.\.)?/, '');
    if (word === '') continue;
    // result tokens
    if (word === '1-0' || word === '0-1' || word === '1/2-1/2' || word === '*') {
      toks.push({ type: 'result', val: word });
      continue;
    }
    toks.push({ type: 'move', san: word });
  }
  return toks.filter((t) => t.type); // drop the placeholder {} from glued NAGs
}

// ---------- clean a SAN token so chess.js accepts it ----------
function cleanSan(san) {
  return san
    .replace(/0-0-0/g, 'O-O-O')
    .replace(/0-0/g, 'O-O')
    .replace(/[!?]+/g, '')
    .replace(/[+#]+$/g, (m) => m[0] === '#' ? '#' : '+') // keep a single check/mate marker
    .replace(/−/g, '-'); // unicode minus
}

// ---------- extract %cal / %csl shapes and strip all [%...] from comment text ----------
const COLOR = { G: 'green', R: 'red', Y: 'yellow', B: 'blue' };
export function parseComment(raw) {
  if (!raw) return { text: '', cal: [], csl: [] };
  const cal = [];
  const csl = [];
  const cmdRe = /\[%(\w+)\s+([^\]]*)\]/g;
  let m;
  while ((m = cmdRe.exec(raw))) {
    const cmd = m[1].toLowerCase();
    const body = m[2];
    if (cmd === 'cal') {
      for (const e of body.split(',')) {
        const t = e.trim();
        if (t.length >= 5) cal.push({ brush: COLOR[t[0]] || 'green', orig: t.slice(1, 3), dest: t.slice(3, 5) });
      }
    } else if (cmd === 'csl') {
      for (const e of body.split(',')) {
        const t = e.trim();
        if (t.length >= 3) csl.push({ brush: COLOR[t[0]] || 'green', orig: t.slice(1, 3) });
      }
    }
  }
  const text = raw.replace(cmdRe, ' ').replace(/\s+/g, ' ').trim();
  return { text, cal, csl };
}

// ---------- NAG glyphs ----------
const NAG = {
  1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!',
  7: '□', 10: '=', 11: '=', 12: '=', 13: '∞',
  14: '⩲', 15: '⩱', 16: '±', 17: '∓',
  18: '+−', 19: '−+', 20: '+−', 21: '−+',
  22: '⨀', 23: '⨀', 36: '→', 40: '↑',
  132: '⇆', 138: '⊕',
};
export function nagGlyph(n) { return NAG[n] || ('$' + n); }

// ---------- build the move tree ----------
export function parseGame(game) {
  const startFen = game.tags.FEN && game.tags.SetUp !== '0' ? game.tags.FEN : DEFAULT_POSITION;
  const toks = tokenize(game.movetext);
  let pos = 0;
  let nodeId = 0;
  const errors = [];

  // root is a virtual node representing the start position
  const root = {
    id: nodeId++, san: null, from: null, to: null,
    fenBefore: null, fen: startFen, color: null, moveNumber: '',
    nags: [], commentRaw: '', children: [], siblingArray: null,
  };

  function moveLabel(fenBefore, color) {
    const parts = fenBefore.split(' ');
    const num = parts[5] || '1';
    return color === 'w' ? num + '.' : num + '...';
  }

  function parseSeq(startFen, siblings) {
    const chess = new Chess(startFen);
    let prev = null;
    let pendingComment = [];
    let pendingNags = [];
    while (pos < toks.length) {
      const t = toks[pos];
      if (t.type === 'close') { pos++; return; }
      if (t.type === 'result') { pos++; continue; }
      if (t.type === 'comment') {
        if (prev) prev.commentRaw += (prev.commentRaw ? ' ' : '') + t.text;
        else pendingComment.push(t.text);
        pos++; continue;
      }
      if (t.type === 'nag') {
        if (prev) prev.nags.push(t.val);
        else pendingNags.push(t.val);
        pos++; continue;
      }
      if (t.type === 'open') {
        pos++;
        if (prev) parseSeq(prev.fenBefore, prev.siblingArray);
        else parseSeq(startFen, siblings); // pre-move variation (rare)
        continue;
      }
      if (t.type === 'move') {
        const fenBefore = chess.fen();
        let mv;
        try {
          mv = chess.move(cleanSan(t.san), { strict: false });
        } catch (e) {
          errors.push(t.san);
          pos++; continue;
        }
        if (!mv) { errors.push(t.san); pos++; continue; }
        const node = {
          id: nodeId++,
          san: mv.san,
          from: mv.from,
          to: mv.to,
          promotion: mv.promotion || null,
          fenBefore,
          fen: chess.fen(),
          color: mv.color,
          moveNumber: moveLabel(fenBefore, mv.color),
          nags: prev ? [] : pendingNags,
          commentBefore: prev ? '' : pendingComment.join(' '),
          commentRaw: '',
          children: [],
          siblingArray: null,
        };
        pendingComment = [];
        pendingNags = [];
        if (!prev) { siblings.push(node); node.siblingArray = siblings; }
        else { prev.children.push(node); node.siblingArray = prev.children; }
        prev = node;
        pos++; continue;
      }
      pos++;
    }
  }

  parseSeq(startFen, root.children);
  return { root, startFen, errors, tags: game.tags };
}
