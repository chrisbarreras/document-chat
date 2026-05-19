#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

const HEADER = '// SPDX-License-Identifier: Apache-2.0';

const ROOTS = ['apps', 'packages', 'scripts'];
const SOURCE_EXT = new Set(['.ts', '.tsx', '.mjs']);

const EXCLUDE = [
  /node_modules/,
  /\.next/,
  /\.turbo/,
  /dist/,
  /coverage/,
  /playwright-report/,
  /test-results/,
  new RegExp(`packages\\${sep}contracts\\${sep}src\\${sep}types\\.ts$`),
  /\.d\.ts$/,
];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (EXCLUDE.some((re) => re.test(path))) continue;
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile()) {
      const ext = path.slice(path.lastIndexOf('.'));
      if (SOURCE_EXT.has(ext)) yield path;
    }
  }
}

let failed = 0;
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const head = readFileSync(file, 'utf8').slice(0, 200);
    if (!head.includes(HEADER)) {
      console.error(`Missing SPDX header: ${file}`);
      failed++;
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) missing the Apache 2.0 SPDX header.`);
  console.error(`Add this as the first line of each file:`);
  console.error(`  ${HEADER}`);
  process.exit(1);
}

console.log('License headers OK.');
