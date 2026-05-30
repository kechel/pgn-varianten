import * as esbuild from 'esbuild';

const banner = `/*!
 * PGN-Varianten-Brett — Copyright (C) 2026 Jan Kechel — GPL-3.0-or-later
 * Bundles: chessground (c) lichess.org — GPL-3.0-or-later; cburnett pieces (c) Colin M. L. Burnett — GPL;
 *          chess.js (c) 2025 Jeff Hlywa — BSD-2-Clause.
 * Source & full license texts: https://github.com/kechel/pgn-varianten (see LICENSE, CREDITS.md).
 */`;

const opts = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  outfile: '../dist/app.js',
  loader: { '.css': 'css', '.pgn': 'text' },
  banner: { js: banner, css: banner },
  legalComments: 'eof',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log('watching…');
} else {
  await esbuild.build(opts);
  console.log('built -> ../dist/app.js + app.css');
}
