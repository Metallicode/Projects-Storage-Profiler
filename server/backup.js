// Backup jobs: copy each selected unit to the destination with rsync, leaving out the
// excluded folders/files, write restore notes next to it, optionally verify by checksum,
// and — in move mode — delete the local copy only after a clean, verified copy.

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile, access, realpath } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LIMITED_FS, mountFor } from './drives.js';
import { fmt, rebuildInstructions } from './notes.js';
import { REBUILD_NOTES_DIR } from './cleanup.js';

const META_DIR = '.backup-meta';
const MOVED_NOTE = 'MOVED-TO-BACKUP.txt';

const isInside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

// rsync treats a pattern as literal unless it contains wildcards; escape them if it does.
function rsyncPattern(rel) {
  return /[*?[]/.test(rel) ? rel.replace(/[*?[\\]/g, '\\$&') : rel;
}

// Case-insensitive rsync pattern for an extension: '.wav' -> '*.[wW][aA][vV]'.
const extPattern = (ext) => '*.' + ext.slice(1).replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`);
const VALID_EXT = /^\.[\w+-][\w.+-]{0,31}$/;

/**
 * Validate a plan against the scan it was built from and return a job (not started).
 * plan = {
 *   dest, mode: 'copy'|'move', verify,
 *   skipExts: ['.wav', …]  — file types left out everywhere (by rsync pattern),
 *   units: [{ id, exclude: [scan-relative paths], include: [big files kept despite skipExts], estimate }]
 * }
 */
export async function createJob(scanResult, plan) {
  const root = await realpath(scanResult.root);
  if (!plan.dest || !path.isAbsolute(plan.dest)) throw new Error('Destination must be an absolute path.');
  // Create the backup folder on the drive, but only one level deep (avoids typos making trees).
  if (!(await stat(plan.dest).catch(() => null)) && (await stat(path.dirname(plan.dest)).catch(() => null))?.isDirectory()) {
    await mkdir(plan.dest);
  }
  const dest = await realpath(plan.dest).catch(() => { throw new Error(`Destination does not exist: ${plan.dest}`); });
  if (!(await stat(dest)).isDirectory()) throw new Error('Destination is not a folder.');
  await access(dest, constants.W_OK).catch(() => { throw new Error('Destination is not writable.'); });
  if (isInside(dest, root) || isInside(root, dest)) {
    throw new Error('Destination and scanned folder must not contain each other.');
  }
  if (!['copy', 'move'].includes(plan.mode)) throw new Error('Unknown mode.');
  if (!plan.units?.length) throw new Error('Nothing selected.');

  const skipExts = [...new Set(plan.skipExts || [])];
  for (const ext of skipExts) if (!VALID_EXT.test(ext)) throw new Error(`Invalid file type: ${ext}`);

  const mount = mountFor(dest);
  const limited = LIMITED_FS.has(mount?.fs);
  const byId = new Map(scanResult.units.map((u) => [u.id, u]));
  const units = [];

  for (const sel of plan.units) {
    const unit = byId.get(sel.id);
    if (!unit) throw new Error(`Unknown unit: ${sel.id}`);
    const src = path.join(root, unit.path);
    if (!isInside(src, root)) throw new Error(`Unit outside scanned folder: ${sel.id}`);

    // Only items the scan reported may be excluded — never arbitrary client paths.
    const rebuildable = new Map(unit.excluded.map((e) => [e.path, e]));
    const big = new Map(unit.big.map((b) => [b.path, b]));
    const secrets = new Set(unit.secrets.map((x) => x.path));
    const gitPath = path.join(unit.path, '.git');
    const exclude = [...new Set(sel.exclude || [])];
    const include = [...new Set(sel.include || [])];
    for (const p of exclude) {
      if (!rebuildable.has(p) && !big.has(p) && !secrets.has(p) && p !== gitPath) throw new Error(`Not an excludable item: ${p}`);
    }
    for (const p of include) if (!big.has(p)) throw new Error(`Not an includable item: ${p}`);

    // Anything left out that can't be rebuilt would be gone for good after a move.
    const lossy = exclude.filter((p) => !rebuildable.has(p));
    const keptByExt = (ext) => include.filter((p) => big.get(p).ext === ext).length;
    const lostTypes = skipExts.filter((ext) => (unit.exts[ext]?.count ?? 0) > keptByExt(ext));
    if (plan.mode === 'move' && (lossy.length || lostTypes.length)) {
      const what = [...lossy.slice(0, 3), ...lostTypes.map((e) => `${e} files`)].join(', ');
      throw new Error(`"${unit.id}": moving would permanently lose items you chose to leave out (${what}). ` +
        'Include them, or use copy mode.');
    }

    units.push({
      id: unit.id,
      kind: unit.kind,
      src,
      dst: path.join(dest, scanResult.rootName, unit.path),
      unit,
      exclude,
      include,
      skipExts: skipExts.filter((ext) => unit.exts[ext]),
      status: 'pending',
      bytesTotal: Math.max(0, Math.min(Number(sel.estimate) || unit.totalBytes, unit.totalBytes)),
      bytesDone: 0,
      percent: 0,
      rate: '',
      errors: [],
      skippedSymlinks: 0,
      mismatches: [],
      moved: false,
    });
  }

  return {
    id: randomUUID(),
    root,
    rootName: scanResult.rootName,
    dest,
    destFs: mount?.fs ?? 'unknown',
    limited,
    mode: plan.mode,
    verify: plan.mode === 'move' || Boolean(plan.verify),
    status: 'pending',
    startedAt: null,
    finishedAt: null,
    manifest: null,
    units,
    child: null,
    cancelled: false,
  };
}

export function snapshot(job) {
  const { child: _child, ...rest } = job;
  return {
    ...rest,
    units: job.units.map(({ unit, ...u }) => ({ ...u, name: unit.name, errors: u.errors.slice(0, 30), mismatches: u.mismatches.slice(0, 30) })),
  };
}

export function cancelJob(job) {
  job.cancelled = true;
  job.child?.kill('SIGTERM');
}

// ---------- restore notes ----------

async function writeRestoreNotes(u, limited) {
  const metaDir = path.join(u.dst, META_DIR);
  await mkdir(metaDir, { recursive: true });
  const relToUnit = (p) => path.relative(u.unit.path, p) || '.';
  const excluded = new Set(u.exclude);
  const md = [
    `# Restore notes — ${u.unit.name}`,
    '',
    `Backed up ${new Date().toISOString()} from \`${u.src}\` by Storage Profiler.`,
    '',
  ];

  const rebuilt = u.unit.excluded.filter((e) => excluded.has(e.path));
  if (rebuilt.length) {
    md.push('## Left out — rebuild these', '');
    for (const e of rebuilt) md.push(...(await rebuildInstructions(e, u.src, relToUnit(e.path), metaDir, META_DIR)).lines);
    md.push('');
  }
  if (existsSync(path.join(u.src, REBUILD_NOTES_DIR))) {
    md.push(`Folders deleted earlier to free space are described in \`${REBUILD_NOTES_DIR}/REBUILD.md\`.`, '');
  }

  const dropped = u.exclude.filter((p) => !u.unit.excluded.some((e) => e.path === p));
  if (dropped.length || u.skipExts.length) {
    md.push('## Left out by choice — NOT in this backup', '');
    for (const p of dropped) md.push(`- \`${relToUnit(p)}\``);
    for (const ext of u.skipExts) md.push(`- all \`${ext}\` files (${u.unit.exts[ext].count}, ${fmt(u.unit.exts[ext].bytes)})`);
    md.push('');
  }

  if (u.unit.symlinks.length) {
    md.push(`## Symlinks${limited ? ' (this drive cannot store them — recreate with `ln -s`)' : ''}`, '');
    for (const s of u.unit.symlinks) md.push(`- \`${relToUnit(s.path)}\` → \`${s.target}\``);
    md.push('');
  }

  await writeFile(path.join(metaDir, 'RESTORE.md'), md.join('\n'));
}

// ---------- rsync ----------

// rsync filter rules, first match wins: kept files, then left-out paths, then file types.
async function filterFile(u, tmpDir) {
  const anchored = (p) => '/' + rsyncPattern(path.relative(u.unit.path, p));
  const rules = [
    ...(u.skipExts.length ? u.include.map((p) => `+ ${anchored(p)}`) : []),
    ...u.exclude.map((p) => `- ${anchored(p)}`),
    ...u.skipExts.map((ext) => `- ${extPattern(ext)}`),
  ];
  if (u.kind === 'loose') rules.push('- /*/'); // loose units are just the files in this folder
  const file = path.join(tmpDir, `${randomUUID()}.filter`);
  await writeFile(file, rules.map((r) => r + '\0').join(''));
  return `--filter=merge ${file}`;
}

function runRsync(job, args, onLine) {
  return new Promise((resolve) => {
    const child = spawn('rsync', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    job.child = child;
    let stderr = '';
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      const parts = buf.split(/[\r\n]/);
      buf = parts.pop();
      parts.forEach((l) => l && onLine(l));
    });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      if (buf) onLine(buf);
      job.child = null;
      resolve({ code, stderr });
    });
    child.on('error', (err) => resolve({ code: -1, stderr: err.message }));
  });
}

async function copyUnit(job, u, tmpDir) {
  const filters = await filterFile(u, tmpDir);
  const base = job.limited ? ['-rt', '--modify-window=2'] : ['-rlpt'];
  const args = [...base, '--from0', filters, '--info=progress2', '--no-inc-recursive', u.src + '/', u.dst + '/'];

  const { code, stderr } = await runRsync(job, args, (line) => {
    const m = line.match(/^\s*([\d,]+)\s+(\d+)%\s+(\S+)/);
    if (m) {
      u.bytesDone = Number(m[1].replaceAll(',', ''));
      u.percent = Number(m[2]);
      u.rate = m[3];
    } else if (line.startsWith('skipping non-regular file')) {
      u.skippedSymlinks++;
    }
  });
  u.errors.push(...stderr.split('\n').filter(Boolean));
  return { code, filters };
}

// Checksum dry-run: lists every file whose content differs or is missing on the backup.
async function verifyUnit(job, u, filters) {
  const args = [job.limited ? '-rc' : '-rlc', '--dry-run', '--out-format=%n',
    '--from0', filters, u.src + '/', u.dst + '/'];
  const lines = [];
  const { code, stderr } = await runRsync(job, args, (l) => lines.push(l));
  u.mismatches = lines.filter((l) => !l.endsWith('/') && !l.startsWith('skipping non-regular file'));
  if (code !== 0) u.errors.push(...stderr.split('\n').filter(Boolean));
  return code === 0 && u.mismatches.length === 0;
}

async function removeLocal(job, u) {
  if (u.kind === 'loose') {
    // Only the folder's own files moved; subfolders are other units.
    const excluded = new Set(u.exclude); // move mode never has lossy exclusions, but be safe
    for (const d of await readdir(u.src, { withFileTypes: true })) {
      const rel = path.join(u.unit.path, d.name);
      if (d.isFile() && !excluded.has(rel)) await rm(path.join(u.src, d.name));
    }
  } else {
    for (const name of await readdir(u.src)) await rm(path.join(u.src, name), { recursive: true, force: true });
  }
  await writeFile(path.join(u.src, MOVED_NOTE),
    `This ${u.kind === 'loose' ? "folder's files were" : 'project was'} moved to:\n  ${u.dst}\n` +
    `on ${new Date().toISOString()} by Storage Profiler.\nRebuild notes: ${path.join(u.dst, META_DIR, 'RESTORE.md')}\n`);
  u.moved = true;
}

export async function runJob(job) {
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'storage-profiler-'));

  try {
    for (const u of job.units) {
      if (job.cancelled) { u.status = 'skipped'; continue; }
      try {
        await mkdir(u.dst, { recursive: true });
        u.status = 'copying';
        await writeRestoreNotes(u, job.limited);
        const { code, filters } = await copyUnit(job, u, tmpDir);
        if (job.cancelled) { u.status = 'failed'; u.errors.push('Cancelled.'); continue; }
        if (code !== 0) {
          u.status = 'failed';
          u.errors.unshift(`rsync exited with code ${code}${code === 23 ? ' (some files could not be copied — see below)' : ''}`);
          continue;
        }
        u.percent = 100;

        if (job.verify) {
          u.status = 'verifying';
          const ok = await verifyUnit(job, u, filters);
          if (!ok) {
            u.status = 'failed';
            u.errors.unshift(`Verification failed: ${u.mismatches.length} file(s) differ between source and backup.`);
            continue;
          }
        }
        if (job.mode === 'move') {
          u.status = 'deleting';
          await removeLocal(job, u);
        }
        u.status = 'done';
      } catch (err) {
        u.status = 'failed';
        u.errors.unshift(err.message);
      }
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  job.finishedAt = new Date().toISOString();
  job.status = job.cancelled ? 'cancelled' : job.units.every((u) => u.status === 'done') ? 'done' : 'failed';

  // Keep a record on the drive itself of what was backed up and what was left out.
  try {
    const dir = path.join(job.dest, job.rootName, '.storage-profiler');
    await mkdir(dir, { recursive: true });
    job.manifest = path.join(dir, `backup-${job.startedAt.replace(/[:.]/g, '-')}.json`);
    const record = snapshot(job);
    record.units = record.units.map((u, i) => ({ ...u, excludedItems: job.units[i].exclude, skippedTypes: job.units[i].skipExts }));
    await writeFile(job.manifest, JSON.stringify(record, null, 2));
  } catch {
    job.manifest = null;
  }
}
