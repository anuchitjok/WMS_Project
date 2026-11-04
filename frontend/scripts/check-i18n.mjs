#!/usr/bin/env node
// Translation consistency check: `npm run check:i18n`.
//
// For every message module it compares Thai and Simplified Chinese against English
// (the source of truth) and fails when a language
//   - is missing a key or has an extra one,
//   - has an empty string,
//   - uses different {placeholders} than English,
//   - has a module file that is not registered in its index.ts.
// The type check already catches missing/extra keys; this also catches the runtime
// problems types can't see (blank strings, broken placeholders) and prints coverage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', 'src', 'i18n', 'messages');
const BASE = 'en';
const LOCALES = ['th', 'zh-CN'];

function loadModule(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  // Message files only import types, so there is nothing real to require.
  new Function('module', 'exports', 'require', out)(mod, mod.exports, () => ({}));
  return mod.exports;
}

function flatten(obj, prefix = '', acc = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, acc);
    else acc[key] = v;
  }
  return acc;
}

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

const modules = fs.readdirSync(path.join(root, BASE))
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
  .map((f) => f.replace(/\.ts$/, ''));

const problems = [];
const coverage = Object.fromEntries(LOCALES.map((l) => [l, { total: 0, done: 0 }]));
let baseTotal = 0;

for (const name of modules) {
  const base = flatten(Object.values(loadModule(path.join(root, BASE, `${name}.ts`)))[0]);
  baseTotal += Object.keys(base).length;

  for (const [k, v] of Object.entries(base)) {
    if (typeof v !== 'string' || !v.trim()) problems.push(`${BASE}/${name}: "${k}" is empty`);
  }

  for (const loc of LOCALES) {
    const file = path.join(root, loc, `${name}.ts`);
    if (!fs.existsSync(file)) { problems.push(`${loc}: module "${name}" is missing`); continue; }
    const tr = flatten(Object.values(loadModule(file))[0]);
    for (const [k, v] of Object.entries(base)) {
      coverage[loc].total++;
      if (!(k in tr)) { problems.push(`${loc}/${name}: missing key "${k}"`); continue; }
      if (typeof tr[k] !== 'string' || !tr[k].trim()) { problems.push(`${loc}/${name}: "${k}" is empty`); continue; }
      if (placeholders(tr[k]) !== placeholders(v)) {
        problems.push(`${loc}/${name}: "${k}" placeholders {${placeholders(tr[k])}} differ from English {${placeholders(v)}}`);
        continue;
      }
      coverage[loc].done++;
    }
    for (const k of Object.keys(tr)) {
      if (!(k in base)) problems.push(`${loc}/${name}: extra key "${k}" not in English`);
    }
  }
}

for (const loc of [BASE, ...LOCALES]) {
  const index = fs.readFileSync(path.join(root, loc, 'index.ts'), 'utf8');
  for (const name of modules) {
    if (!index.includes(`from './${name}'`) || !new RegExp(`^\\s+${name},$`, 'm').test(index)) {
      problems.push(`${loc}/index.ts: module "${name}" is not registered`);
    }
  }
}

console.log(`i18n: ${modules.length} modules, ${baseTotal} English strings`);
for (const loc of LOCALES) {
  const { total, done } = coverage[loc];
  console.log(`  ${loc.padEnd(6)} ${done}/${total} (${total ? ((done / total) * 100).toFixed(1) : '0.0'}%)`);
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('OK — every language has the same keys and placeholders.');
