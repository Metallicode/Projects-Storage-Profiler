// How to rebuild a folder we leave out (backup) or delete (cleanup).
// Shared so the backup's RESTORE.md and the local REBUILD.md say the same thing.

import { execFile } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function fmt(bytes) {
  if (!bytes) return '0 B';
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${['B', 'KB', 'MB', 'GB', 'TB'][i]}`;
}

function execText(cmd, args, timeout = 60_000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 16 << 20 }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

// Fallback when the venv's python no longer runs: read installed dists from site-packages.
async function distInfoFreeze(venvAbs) {
  try {
    const lib = path.join(venvAbs, 'lib');
    const lines = [];
    for (const py of await readdir(lib)) {
      const sp = path.join(lib, py, 'site-packages');
      for (const name of await readdir(sp).catch(() => [])) {
        const m = name.match(/^(.+?)-([^-]+)\.dist-info$/);
        if (m) lines.push(`${m[1]}==${m[2]}`);
      }
    }
    return lines.length ? `# reconstructed from site-packages (pip freeze failed)\n${lines.sort().join('\n')}\n` : null;
  } catch {
    return null;
  }
}

/**
 * Markdown lines describing how to rebuild one rebuildable folder. For venvs the package
 * list is captured into `notesAbs` (referenced as `notesRel` from the project folder).
 * @returns {{ lines: string[], captured: boolean }} captured is false only when a venv's
 *   packages could not be recorded.
 */
export async function rebuildInstructions(item, projectAbs, rel, notesAbs, notesRel) {
  const lines = [`- \`${rel}/\` — ${item.label}${item.detail ? ` (${item.detail})` : ''}, ${fmt(item.bytes)}`];
  let captured = true;

  if (item.rebuild === 'python-venv') {
    const venvAbs = path.join(projectAbs, rel);
    const reqName = `${rel.replaceAll('/', '__')}.requirements.txt`;
    const freeze = (await execText(path.join(venvAbs, 'bin', 'python'), ['-m', 'pip', 'freeze'])) ?? (await distInfoFreeze(venvAbs));
    const pyVer = item.detail?.match(/(\d+\.\d+)/)?.[1];
    if (freeze !== null) {
      await writeFile(path.join(notesAbs, reqName), freeze);
      lines.push(`  \`python${pyVer ?? '3'} -m venv ${rel} && ${rel}/bin/pip install -r ${notesRel}/${reqName}\``);
    } else {
      captured = false;
      lines.push(`  Package list could not be captured; recreate with \`python${pyVer ?? '3'} -m venv ${rel}\`.`);
    }
  } else if (item.rebuild === 'conda-env') {
    lines.push('  Recreate from your environment.yml (`conda env create -f environment.yml`).');
  } else if (item.rebuild === 'node') {
    lines.push(`  Run \`npm ci\` (or your package manager's install) in \`${path.dirname(rel)}\`.`);
  } else if (item.rebuild === 'unity') {
    const ver = await readFile(path.join(projectAbs, path.dirname(rel), 'ProjectSettings', 'ProjectVersion.txt'), 'utf8').catch(() => '');
    const m = ver.match(/m_EditorVersion:\s*(\S+)/);
    lines.push(`  Open the project in Unity${m ? ` ${m[1]}` : ''}; it regenerates this folder.`);
  } else if (item.rebuild === 'build') {
    lines.push('  Build output — regenerate by building the project.');
  } else {
    lines.push('  Cache — regenerated automatically.');
  }
  return { lines, captured };
}
