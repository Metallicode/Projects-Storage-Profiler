// Walks a folder tree and groups it into backup "units":
//   project — a folder with project markers (.git, package.json, Unity ProjectSettings…);
//             everything below it belongs to it, nested projects included
//   folder  — a subtree with no projects in it (course material, media dumps…)
//   loose   — the files sitting directly in a folder whose subfolders contain projects
//
// Rebuildable folders (venvs, node_modules, Unity Library…) are sized with `du`
// instead of being walked file by file, which keeps scanning millions of venv files fast.

import { readdir, readlink, readFile } from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { classifyDir, classifyHeavyFile, classifySecret, detectProjectTypes, extOf } from './classify.js';

// Files at least this big are listed individually, so they can be skipped one by one or by size.
const BIG_FILE_BYTES = 1024 * 1024;

function duBytes(absPath) {
  return new Promise((resolve) => {
    execFile('du', ['-sb', absPath], { maxBuffer: 1 << 20 }, (err, stdout) => {
      // du exits non-zero on unreadable subfolders but still prints a total.
      const n = parseInt(String(stdout).split('\t')[0], 10);
      resolve(Number.isFinite(n) ? n : 0);
    });
  });
}

// Small semaphore so a tree full of venvs doesn't spawn 50 `du`s at once.
function limiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve } = queue.shift();
    fn().then(resolve).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve) => { queue.push({ fn, resolve }); next(); });
}

async function venvPythonVersion(absPath) {
  try {
    const cfg = await readFile(path.join(absPath, 'pyvenv.cfg'), 'utf8');
    const m = cfg.match(/^version(?:_info)?\s*=\s*([\d.]+)/m);
    return m ? `Python ${m[1]}` : null;
  } catch {
    return null;
  }
}

function newUnit(relPath, kind, types) {
  return {
    path: relPath,
    name: relPath ? path.basename(relPath) : '.',
    kind,
    types,
    files: 0,
    fileBytes: 0,
    gitBytes: 0,
    excluded: [], // rebuildable folders: { path, label, kind, rebuild, bytes, detail }
    heavy: [],    // large files: { path, bytes, category }
    big: [],      // every file >= 1 MB: { path, bytes, ext } (heavy files are a subset)
    exts: {},     // per extension: { count, bytes }
    secrets: [],  // { path, kind } — .env, keys, credentials
    ignored: [],  // git-ignored but not rebuildable: { path, bytes, dir } — only copy is local
    lastModified: 0,
    gitRoot: false,
    symlinks: [], // { path, target } — not copyable to exFAT/FAT drives
    errors: [],
  };
}

function addExt(unit, ext, count, bytes) {
  const e = (unit.exts[ext] ??= { count: 0, bytes: 0 });
  e.count += count;
  e.bytes += bytes;
}

// Ask git which untracked paths it ignores (folders collapsed to one entry).
function gitIgnored(absPath) {
  return new Promise((resolve) => {
    execFile('git', ['-C', absPath, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'],
      { maxBuffer: 64 << 20, timeout: 60_000 }, (err, stdout) => resolve(err ? [] : String(stdout).split('\0').filter(Boolean)));
  });
}

function mergeInto(target, src) {
  target.files += src.files;
  target.fileBytes += src.fileBytes;
  target.gitBytes += src.gitBytes;
  target.excluded.push(...src.excluded);
  target.heavy.push(...src.heavy);
  target.symlinks.push(...src.symlinks);
  target.big.push(...src.big);
  target.secrets.push(...src.secrets);
  target.lastModified = Math.max(target.lastModified, src.lastModified);
  for (const [ext, e] of Object.entries(src.exts)) addExt(target, ext, e.count, e.bytes);
  target.errors.push(...src.errors);
}

/**
 * @param {string} root absolute folder to scan
 * @param {(p: {files:number, bytes:number, dir:string}) => void} onProgress
 * @param {{ cancelled: boolean }} signal
 */
export async function scan(root, onProgress = () => {}, signal = { cancelled: false }) {
  const runDu = limiter(4);
  const pending = [];
  let files = 0;
  let bytes = 0;
  let lastReport = 0;

  const report = (dir) => {
    const now = Date.now();
    if (now - lastReport > 200) {
      lastReport = now;
      onProgress({ files, bytes, dir });
    }
  };

  const rel = (abs) => path.relative(root, abs);

  // Git-ignored paths that are not rebuildable are exactly what a remote repo won't have.
  async function findIgnored(unit) {
    const unitAbs = path.join(root, unit.path);
    const rebuildable = unit.excluded.map((e) => e.path);
    const covered = (p) => rebuildable.some((r) => p === r || p.startsWith(r + '/'));
    for (const entry of await gitIgnored(unitAbs)) {
      const isDir = entry.endsWith('/');
      const p = path.join(unit.path, entry.replace(/\/$/, ''));
      if (covered(p) || p.split('/').includes('.git')) continue;
      let size = 0;
      if (isDir) {
        // Don't count rebuildable folders that live inside an ignored folder.
        const inner = unit.excluded.filter((e) => e.path.startsWith(p + '/')).reduce((s, e) => s + e.bytes, 0);
        size = Math.max(0, (await duBytes(path.join(root, p))) - inner);
        if (!size) continue;
      } else {
        try { size = lstatSync(path.join(root, p)).size; } catch { continue; }
      }
      unit.ignored.push({ path: p, bytes: size, dir: isDir });
    }
  }

  async function list(abs, unit) {
    try {
      return await readdir(abs, { withFileTypes: true });
    } catch (err) {
      unit.errors.push(`${rel(abs) || '.'}: ${err.code || err.message}`);
      return [];
    }
  }

  // Account for the entries of one folder. Normal subfolders are handed to `descend`.
  async function fill(abs, dirents, unit, descend) {
    const names = new Set(dirents.map((d) => d.name));
    report(rel(abs));
    for (const d of dirents) {
      if (signal.cancelled) return;
      const childAbs = path.join(abs, d.name);
      const childRel = rel(childAbs);

      if (d.isSymbolicLink()) {
        let target = '';
        try { target = await readlink(childAbs); } catch { /* unreadable link */ }
        unit.symlinks.push({ path: childRel, target });
      } else if (d.isFile()) {
        let st;
        try { st = lstatSync(childAbs); } catch { continue; }
        const size = st.size;
        const ext = extOf(d.name);
        unit.files++;
        unit.fileBytes += size;
        unit.lastModified = Math.max(unit.lastModified, st.mtimeMs);
        addExt(unit, ext, 1, size);
        files++;
        bytes += size;
        if (size >= BIG_FILE_BYTES) unit.big.push({ path: childRel, bytes: size, ext });
        const category = classifyHeavyFile(d.name, size);
        if (category) unit.heavy.push({ path: childRel, bytes: size, category });
        const secret = classifySecret(d.name);
        if (secret) unit.secrets.push({ path: childRel, kind: secret });
      } else if (d.isDirectory()) {
        if (d.name === '.git') {
          pending.push(runDu(() => duBytes(childAbs)).then((b) => { unit.gitBytes += b; bytes += b; }));
          continue;
        }
        const c = classifyDir(d.name, childAbs, names);
        if (c) {
          const entry = { path: childRel, ...c, bytes: 0, detail: null };
          unit.excluded.push(entry);
          if (c.rebuild === 'python-venv') entry.detail = await venvPythonVersion(childAbs);
          pending.push(runDu(() => duBytes(childAbs)).then((b) => { entry.bytes = b; bytes += b; }));
          continue;
        }
        await descend(childAbs);
      }
    }
  }

  async function walkInside(abs, unit) {
    const dirents = await list(abs, unit);
    await fill(abs, dirents, unit, (child) => walkInside(child, unit));
  }

  // Returns { hasProject, units } for the subtree at `abs`.
  async function visit(abs) {
    const probe = newUnit(rel(abs), 'folder', []);
    const dirents = await list(abs, probe);
    const types = detectProjectTypes(new Set(dirents.map((d) => d.name)));

    if (types.length) {
      const unit = newUnit(rel(abs), 'project', types);
      unit.errors.push(...probe.errors);
      unit.gitRoot = dirents.some((d) => d.name === '.git' && d.isDirectory());
      await fill(abs, dirents, unit, (child) => walkInside(child, unit));
      return { hasProject: true, units: [unit] };
    }

    const children = [];
    await fill(abs, dirents, probe, async (child) => { children.push(await visit(child)); });

    if (!children.some((c) => c.hasProject)) {
      for (const c of children) for (const u of c.units) mergeInto(probe, u);
      return { hasProject: false, units: [probe] };
    }
    probe.kind = 'loose';
    const units = children.flatMap((c) => c.units);
    if (probe.files || probe.excluded.length || probe.symlinks.length) units.unshift(probe);
    return { hasProject: true, units };
  }

  const { units } = await visit(root);
  await Promise.all(pending);
  await Promise.all(units.filter((u) => u.gitRoot).map((u) => runDu(() => findIgnored(u))));
  onProgress({ files, bytes, dir: '' });

  for (const u of units) {
    u.id = u.path || '.';
    u.excludedBytes = u.excluded.reduce((s, e) => s + e.bytes, 0);
    u.heavyBytes = u.heavy.reduce((s, h) => s + h.bytes, 0);
    u.totalBytes = u.fileBytes + u.gitBytes + u.excludedBytes;
    u.excluded.sort((a, b) => b.bytes - a.bytes);
    u.heavy.sort((a, b) => b.bytes - a.bytes);
    // Nested repos can report both a folder and paths inside it; keep the outermost.
    const ignoredDirs = u.ignored.filter((i) => i.dir).map((i) => i.path);
    u.ignored = u.ignored.filter((i) => !ignoredDirs.some((d) => i.path.startsWith(d + '/')));
    u.ignored.sort((a, b) => b.bytes - a.bytes);
    u.ignored = u.ignored.slice(0, 100);
    u.errors = u.errors.slice(0, 50);
  }
  units.sort((a, b) => b.totalBytes - a.totalBytes);

  return {
    root,
    rootName: path.basename(root),
    scannedAt: new Date().toISOString(),
    cancelled: signal.cancelled,
    units,
  };
}
