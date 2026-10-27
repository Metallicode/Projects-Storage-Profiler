import { useEffect, useState } from 'react';
import { formatBytes, getJson } from '../api.js';

const FS_NOTES = {
  exfat: 'exFAT drive: no symlinks or Unix permissions. Files copy fine; symlinks are recorded in the restore notes.',
  vfat: 'FAT32 drive: no symlinks, and files over 4 GB cannot be stored. Consider reformatting to exFAT or ext4.',
  ntfs: 'NTFS drive: Unix permissions are not kept.',
  fuseblk: 'NTFS/FUSE drive: Unix permissions are not kept.',
};

export default function DestinationPanel({ copyBytes, unitCount, lossyCount, onStart, onBrowse, dest, setDest, busy }) {
  const [drives, setDrives] = useState(null);
  const [mode, setMode] = useState('copy');
  const [verify, setVerify] = useState(true);
  const [confirming, setConfirming] = useState(false);

  const refresh = () => getJson('/api/drives').then((d) => {
    setDrives(d);
    if (!dest && d.length) setDest(`${d[0].mount}/ProjectBackups`);
  }).catch(() => setDrives([]));
  useEffect(() => { refresh(); }, []);

  const drive = drives?.filter((d) => dest === d.mount || dest.startsWith(d.mount + '/')).sort((a, b) => b.mount.length - a.mount.length)[0];
  const tooBig = drive && copyBytes > drive.free;
  const moveBlocked = mode === 'move' && lossyCount > 0;
  const canStart = dest && unitCount > 0 && !busy && !moveBlocked;

  const start = () => (mode === 'move' ? setConfirming(true) : onStart({ mode, verify }));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-white">Back up to</h3>
        <button className="text-xs text-slate-400 hover:text-white" onClick={refresh}>↻ refresh drives</button>
      </div>

      <div className="flex flex-wrap gap-2">
        {drives?.map((d) => (
          <button
            key={d.mount}
            onClick={() => setDest(`${d.mount}/ProjectBackups`)}
            className={`text-left rounded-lg border px-3 py-2 min-w-48 ${drive?.mount === d.mount ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 hover:border-slate-500'}`}
          >
            <div className="text-sm text-white font-medium">{d.label}</div>
            <div className="text-xs text-slate-400">{formatBytes(d.free)} free of {formatBytes(d.total)} · {d.fs}</div>
            <div className="mt-1.5 h-1 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-slate-400" style={{ width: `${100 - (d.free / d.total) * 100}%` }} />
            </div>
          </button>
        ))}
        {drives && !drives.length && <p className="text-sm text-slate-500">No external drives mounted. Plug one in, or pick any folder below.</p>}
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-200 focus:outline-none focus:border-blue-500"
          placeholder="/media/you/Drive/ProjectBackups"
          value={dest}
          onChange={(e) => setDest(e.target.value)}
        />
        <button className="px-3 py-2 text-sm rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200" onClick={onBrowse}>Browse…</button>
      </div>
      {drive && FS_NOTES[drive.fs] && <p className="text-xs text-amber-300/80">{FS_NOTES[drive.fs]}</p>}

      <div className="grid grid-cols-2 gap-2">
        {[
          ['copy', 'Copy', 'Keep everything here. Re-running only copies what changed.'],
          ['move', 'Move (archive)', 'Copy, verify by checksum, then delete the local folder to free space.'],
        ].map(([value, label, hint]) => (
          <button
            key={value}
            onClick={() => setMode(value)}
            className={`text-left rounded-lg border p-3 ${mode === value ? (value === 'move' ? 'border-red-500/70 bg-red-500/10' : 'border-blue-500 bg-blue-500/10') : 'border-slate-700 hover:border-slate-500'}`}
          >
            <div className="text-sm text-white font-medium">{label}</div>
            <div className="text-xs text-slate-400 mt-0.5">{hint}</div>
          </button>
        ))}
      </div>

      {mode === 'copy' && (
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" className="accent-blue-500" checked={verify} onChange={(e) => setVerify(e.target.checked)} />
          Verify by checksum after copying (slower, rereads everything)
        </label>
      )}
      {moveBlocked && (
        <p className="text-sm text-amber-300">
          {lossyCount} selected unit(s) leave out files that can't be rebuilt (large files, file types, secrets or git history). Moving would delete those for good — include them, or use Copy.
        </p>
      )}
      {tooBig && <p className="text-sm text-red-400">Needs {formatBytes(copyBytes)} but the drive has {formatBytes(drive.free)} free (less if a previous backup is already there).</p>}

      <div className="flex items-center justify-between gap-4 pt-1">
        <div className="text-sm text-slate-400">
          <span className="text-white font-semibold text-lg">{formatBytes(copyBytes)}</span> from {unitCount} unit{unitCount === 1 ? '' : 's'}
        </div>
        <button
          disabled={!canStart}
          onClick={start}
          className={`px-6 py-2.5 rounded-lg font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed ${mode === 'move' ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'}`}
        >
          {mode === 'move' ? 'Move to drive' : 'Start backup'}
        </button>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setConfirming(false)}>
          <div className="bg-slate-900 border border-red-500/40 rounded-xl max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white text-lg font-medium">Move {unitCount} unit(s) off this computer?</h3>
            <p className="text-sm text-slate-300">
              Each one is copied to <span className="font-mono text-slate-200">{dest}</span>, checked by checksum, and only then
              deleted locally — <strong>including its venvs, node_modules and build folders</strong>, which are not copied.
              Restore notes (pip freeze, Unity version…) are saved next to each backup so you can rebuild them.
            </p>
            <p className="text-sm text-slate-400">If anything fails to copy or verify, that unit is left untouched.</p>
            <div className="flex justify-end gap-2">
              <button className="px-4 py-2 text-sm rounded-lg text-slate-300 hover:bg-slate-800" onClick={() => setConfirming(false)}>Cancel</button>
              <button
                className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white"
                onClick={() => { setConfirming(false); onStart({ mode, verify: true }); }}
              >
                Move and delete local copies
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
