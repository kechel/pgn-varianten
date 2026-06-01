import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const banner = `/*!
 * PGN-Varianten-Brett — Copyright (C) 2026 Jan Kechel — GPL-3.0-or-later
 * Bundles: chessground (c) lichess.org — GPL-3.0-or-later; cburnett pieces (c) Colin M. L. Burnett — GPL;
 *          chess.js (c) 2025 Jeff Hlywa — BSD-2-Clause.
 * Source & full license texts: https://github.com/kechel/pgn-varianten (see LICENSE, CREDITS.md).
 */`;

// ------------------------------------------------------------------
// dist/engine.js — lazy-loaded Stockfish (loaded only when the user turns the
// engine on). It embeds the lite single-threaded WASM build as base64 so the
// whole thing runs offline from file:// — no fetch, no SharedArrayBuffer, no
// COOP/COEP headers.
//
// The engine glue runs inside a Blob Worker (Chrome allows blob workers from a
// file:// page, unlike file:// or fetch). It must NOT fetch the wasm: a blob
// worker on a file:// page can't fetch even a blob: URL ("Failed to fetch").
// So we hand the wasm to the worker as raw bytes via Emscripten's
// Module.wasmBinary — the worker prelude decodes the embedded base64 into
// self.__SF_WASM and we patch the glue's Module config to read it.
function buildEngine() {
  const require = createRequire(import.meta.url);
  const sfDir = require.resolve('stockfish/package.json').replace(/package\.json$/, 'bin/');
  let glue = readFileSync(sfDir + 'stockfish-18-lite-single.js', 'utf8');
  const wasmB64 = readFileSync(sfDir + 'stockfish-18-lite-single.wasm').toString('base64');

  // patch the worker-mode Module config to take the wasm from self.__SF_WASM
  const anchor = 'listener:function(e){postMessage(e)}}';
  if (glue.split(anchor).length - 1 !== 1) {
    throw new Error('engine glue patch anchor not found exactly once — Stockfish build changed; revisit build.mjs');
  }
  glue = glue.replace(anchor, 'listener:function(e){postMessage(e)},wasmBinary:self.__SF_WASM}');

  const engineBanner = `/*!
 * PGN-Varianten-Brett engine bundle — GPL-3.0-or-later.
 * Embeds Stockfish.js 18 (lite, single-threaded) (c) 2026 Chess.com, LLC — GPL-3.0,
 *   based on Stockfish (c) the Stockfish authors; NNUE net by Linmiao Xu (linrock).
 *   https://github.com/nmrugg/stockfish.js
 * Full license texts & source: https://github.com/kechel/pgn-varianten (LICENSE, CREDITS.md).
 */`;
  // worker prelude: decode the base64 wasm into self.__SF_WASM, then the glue.
  // base64 uses only [A-Za-z0-9+/=] so it embeds safely inside a "…" literal.
  const workerBody =
    'self.__SF_WASM=(function(b){var s=atob(b),n=s.length,a=new Uint8Array(n);for(var i=0;i<n;i++)a[i]=s.charCodeAt(i);return a;})("' + wasmB64 + '");\n' +
    glue;
  const out = engineBanner + '\n(function(){\n' +
    'var SF_WORKER=' + JSON.stringify(workerBody) + ';\n' +
    'window.PgnEngine={load:function(){\n' +
    '  var url=URL.createObjectURL(new Blob([SF_WORKER],{type:"text/javascript"}));\n' +
    '  var worker=new Worker(url);\n' +
    '  var listeners=[];\n' +
    '  worker.onmessage=function(e){var line=typeof e.data==="string"?e.data:(e.data&&e.data.data);if(line!=null)listeners.forEach(function(f){f(line);});};\n' +
    '  return {\n' +
    '    send:function(c){worker.postMessage(c);},\n' +
    '    onLine:function(f){listeners.push(f);},\n' +
    '    quit:function(){try{worker.postMessage("quit");}catch(_){}worker.terminate();URL.revokeObjectURL(url);}\n' +
    '  };\n' +
    '}};\n' +
    '})();\n';
  writeFileSync('../dist/engine.js', out);
  console.log('built -> ../dist/engine.js (' + (out.length / 1048576).toFixed(1) + ' MB, embedded wasm)');
}

const opts = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  outfile: '../dist/app.js',
  loader: { '.css': 'css', '.pgn': 'text', '.png': 'dataurl' },
  banner: { js: banner, css: banner },
  legalComments: 'eof',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  buildEngine();
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log('watching… (engine.js not rebuilt in watch mode — run once without --watch)');
} else {
  await esbuild.build(opts);
  console.log('built -> ../dist/app.js + app.css');
  buildEngine();
}
