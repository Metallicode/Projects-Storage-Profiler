// Free up space locally: delete rebuildable folders (venvs, node_modules, build output…)
// after writing rebuild notes into the project's .rebuild-notes/ folder.
// Every folder is re-checked on disk right before deletion, independent of the scan.

import { appendFile, lstat, mkdir, readdir, rm, rmdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { classifyDir } from './classify.js';
import { rebuildInstructions } from './notes.js';

export const REBUILD_NOTES_DIR = '.rebuild-notes';

/** plan = { items: [scan-relative paths of rebuildable folders] } */
export function createCleanupJob(scanResult, plan) {
  const wanted = new Set(plan.items || []);
  if (!wanted.size) throw new Error('Nothing selected.');
  const units = [];
  for (const unit of scanResult.units) {
    const items = unit.excluded.filter((e) => wanted.has(e.path));
    items.forEach((e) => wanted.delete(e.path));
    if (!items.length) continue;
    const bytesTotal = items.reduce((s, e) => s + e.bytes, 0);
    units.push({ id: unit.id, unit, src: path.join(scanResult.root, unit.path), items, status: 'pending', bytesTotal, bytesDone: 0, percent: 0, errors: [], mismatches: [] });
  }
  if (wanted.size) throw new Error(`Not a rebuildable folder: ${[...wanted][0]}`);

  return {
    id: randomUUID(),
    root: scanResult.root,
    rootName: scanResult.rootName,
    mode: 'cleanup',
    status: 'pending',
    startedAt: null,
    finishedAt: null,
    units,
    child: null,
    cancelled: false,
  };
}

// Is this still the same kind of rebuildable folder the scan saw?
async function stillRebuildable(abs, item) {
  const st = await lstat(abs).catch(() => null);
  if (!st?.isDirectory()) return 'no longer exists';
  const siblings = new Set(await readdir(path.dirname(abs)));
  const now = classifyDir(path.basename(abs), abs, siblings);
  return now?.rebuild === item.rebuild ? null : 'no longer looks rebuildable';
}

export async function runCleanupJob(job) {
  job.status = 'running';
  job.startedAt = new Date().toISOString();

  for (const u of job.units) {
    if (job.cancelled) { u.status = 'skipped'; continue; }
    u.status = 'deleting';
    const notesAbs = path.join(u.src, REBUILD_NOTES_DIR);
    const md = ['', `## Deleted ${new Date().toISOString()} to free space`, ''];
    let deleted = 0;
    try {
      await mkdir(notesAbs, { recursive: true });
      for (const item of u.items) {
        if (job.cancelled) break;
        const rel = path.relative(u.unit.path, item.path);
        const abs = path.join(u.src, rel);
        const problem = await stillRebuildable(abs, item);
        if (problem) { u.errors.push(`${rel}: ${problem} — skipped`); continue; }

        const { lines, captured } = await rebuildInstructions(item, u.src, rel, notesAbs, REBUILD_NOTES_DIR);
        if (!captured) { u.errors.push(`${rel}: couldn't record its packages — kept`); continue; }
        await rm(abs, { recursive: true, force: true });
        md.push(...lines);
        deleted++;
        u.bytesDone += item.bytes;
        u.percent = Math.round((u.bytesDone / u.bytesTotal) * 100);
      }
      if (deleted) {
        const file = path.join(notesAbs, 'REBUILD.md');
        if (!existsSync(file)) md.unshift(`# Rebuild notes — ${u.unit.name}`, '', 'Folders Storage Profiler deleted to free space, and how to get them back.');
        await appendFile(file, md.join('\n') + '\n');
      } else {
        await rmdir(notesAbs).catch(() => {}); // only succeeds if it's empty
      }
      u.status = u.errors.length ? 'failed' : 'done';
    } catch (err) {
      u.status = 'failed';
      u.errors.unshift(err.message);
    }
  }

  job.finishedAt = new Date().toISOString();
  job.status = job.cancelled ? 'cancelled' : job.units.every((u) => u.status === 'done') ? 'done' : 'failed';
}
