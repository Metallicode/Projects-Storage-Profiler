// Mounted-drive discovery from /proc/mounts (Linux).

import { readFileSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import path from 'node:path';

// Filesystems without symlinks / unix permissions; rsync needs gentler flags for them.
export const LIMITED_FS = new Set(['vfat', 'msdos', 'exfat', 'ntfs', 'ntfs3', 'fuseblk']);

// /proc/mounts escapes spaces and friends as octal (\040).
const unescape = (s) => s.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));

function readMounts() {
  return readFileSync('/proc/mounts', 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const [device, mount, fs] = line.split(' ');
      return { device, mount: unescape(mount), fs };
    });
}

/** The mount containing `p` (longest matching mount point). */
export function mountFor(p) {
  const abs = path.resolve(p);
  let best = null;
  for (const m of readMounts()) {
    const inside = abs === m.mount || abs.startsWith(m.mount === '/' ? '/' : m.mount + '/');
    if (inside && (!best || m.mount.length > best.mount.length)) best = m;
  }
  return best;
}

/** External / removable drives: anything mounted under /media, /run/media or /mnt. */
export async function listDrives() {
  const drives = [];
  for (const m of readMounts()) {
    if (!/^\/(media|run\/media|mnt)\//.test(m.mount)) continue;
    try {
      const s = await statfs(m.mount);
      drives.push({
        mount: m.mount,
        label: path.basename(m.mount),
        device: m.device,
        fs: m.fs,
        limited: LIMITED_FS.has(m.fs),
        total: s.blocks * s.bsize,
        free: s.bavail * s.bsize,
      });
    } catch {
      // Unreadable mount (e.g. stale network share) — skip it.
    }
  }
  return drives;
}
