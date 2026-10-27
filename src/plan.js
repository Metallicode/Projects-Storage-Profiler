// Turns a scan + the user's choices into per-unit numbers and a backup plan.
//
// Every unit has optional "items" the user can toggle:
//   rebuildable — venvs, node_modules, build output, caches   (left out by default)
//   heavy       — large media / model / archive files          (kept unless a file-type rule skips them)
//   secret      — .env files, keys, credentials                (kept by default, flagged)
//   git         — the .git history folder                      (kept by default)
// On top of that, file-type rules ({ '.wav': 'all' | maxBytes }) apply to every selected unit.
// Precedence: a per-item checkbox > file-type rule > default.

import { extOf } from './fileTypes.js';

export function unitItems(unit) {
  const items = [
    ...unit.excluded.map((e) => ({ ...e, type: 'rebuildable' })),
    ...unit.heavy.map((h) => ({ ...h, type: 'heavy', label: h.category, ext: extOf(h.path) })),
    ...unit.secrets.map((s) => ({ ...s, type: 'secret', label: s.kind, bytes: 0 })),
  ];
  if (unit.gitBytes) items.push({ path: unit.path ? `${unit.path}/.git` : '.git', type: 'git', label: 'git history', bytes: unit.gitBytes });
  return items;
}

export function ruleSkips(file, rules) {
  const r = rules[file.ext];
  return r === 'all' || (typeof r === 'number' && file.bytes > r);
}

export function isIncluded(item, choices) {
  if (item.path in choices.overrides) return choices.overrides[item.path];
  if (item.type === 'rebuildable') return false;
  if (item.type === 'heavy') return !ruleSkips(item, choices.rules);
  return true;
}

/** Per-unit figures for the table and the totals, plus the exclude/include lists for the server. */
export function summarizeUnit(unit, choices) {
  const { rules, overrides } = choices;
  const items = unitItems(unit);
  const exclude = [];
  const include = [];
  const lossy = []; // left-out things that can't be rebuilt — a move would lose them
  let excludedBytes = 0;
  let typeSkippedBytes = 0;
  let typeSkippedFiles = 0;

  for (const item of items) {
    if (item.type === 'heavy' || isIncluded(item, choices)) continue; // heavy files are handled with `big` below
    excludedBytes += item.bytes;
    exclude.push(item.path);
    if (item.type !== 'rebuildable') lossy.push(item.path);
  }

  // Files >= 1 MB are known individually; smaller ones only as per-extension totals.
  const bigByExt = {};
  for (const f of unit.big) {
    const skipAll = rules[f.ext] === 'all';
    const kept = f.path in overrides ? overrides[f.path] : !ruleSkips(f, rules);
    if (skipAll) bigByExt[f.ext] = (bigByExt[f.ext] ?? 0) + f.bytes;
    if (kept) {
      if (skipAll) include.push(f.path);
      continue;
    }
    excludedBytes += f.bytes;
    if (!(f.path in overrides)) { typeSkippedBytes += f.bytes; typeSkippedFiles++; }
    if (!skipAll) exclude.push(f.path);
    lossy.push(f.path);
  }
  const skipExts = [];
  for (const [ext, rule] of Object.entries(rules)) {
    const stats = unit.exts[ext];
    if (rule !== 'all' || !stats) continue;
    skipExts.push(ext);
    const small = stats.bytes - (bigByExt[ext] ?? 0);
    const smallCount = stats.count - unit.big.filter((f) => f.ext === ext).length;
    excludedBytes += small;
    typeSkippedBytes += small;
    typeSkippedFiles += smallCount;
    if (smallCount > 0) lossy.push(`${ext} files`);
  }

  return {
    items,
    exclude,
    include,
    skipExts,
    lossy,
    typeSkippedBytes,
    typeSkippedFiles,
    copyBytes: Math.max(0, unit.totalBytes - excludedBytes),
  };
}

export function totals(units) {
  const t = { total: 0, rebuildable: 0, heavy: 0, git: 0, work: 0 };
  for (const u of units) {
    t.total += u.totalBytes;
    t.rebuildable += u.excludedBytes;
    t.heavy += u.heavyBytes;
    t.git += u.gitBytes;
    t.work += u.fileBytes - u.heavyBytes;
  }
  return t;
}

export const KIND_LABEL = { project: 'Project', folder: 'Folder', loose: 'Loose files' };

export function timeAgo(ms) {
  if (!ms) return 'unknown';
  const days = (Date.now() - ms) / 864e5;
  if (days < 1) return 'today';
  if (days < 30) return `${Math.round(days)} d ago`;
  if (days < 365) return `${Math.round(days / 30)} mo ago`;
  return `${(days / 365).toFixed(1)} y ago`;
}
