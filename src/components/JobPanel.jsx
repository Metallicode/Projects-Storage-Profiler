import { formatBytes, postJson } from '../api.js';

const STATUS_STYLE = {
  pending: 'text-slate-500',
  copying: 'text-blue-400',
  verifying: 'text-sky-400',
  deleting: 'text-red-400',
  done: 'text-emerald-400',
  failed: 'text-red-400',
  skipped: 'text-slate-500',
};

export default function JobPanel({ job, onClose, onRescan }) {
  const running = ['pending', 'running'].includes(job.status);
  const cleanup = job.mode === 'cleanup';
  const total = job.units.reduce((s, u) => s + u.bytesTotal, 0);
  // Cleanup reports exactly what it deleted; copies report rsync progress against the estimate.
  const done = job.units.reduce((s, u) => s + (u.status === 'done' && !cleanup ? u.bytesTotal : Math.min(u.bytesDone, u.bytesTotal)), 0);
  const failed = job.units.filter((u) => u.status === 'failed');
  const current = job.units.find((u) => ['copying', 'verifying', 'deleting'].includes(u.status));
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium text-white">
            {running
              ? { move: 'Moving…', copy: 'Backing up…', cleanup: 'Freeing up space…' }[job.mode]
              : { done: cleanup ? 'Space freed' : 'Backup complete', failed: 'Finished with problems', cancelled: 'Cancelled' }[job.status]}
          </h3>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            {cleanup ? "Rebuild notes are in each project's .rebuild-notes/REBUILD.md" : `${job.dest}/${job.rootName}`}
          </p>
        </div>
        {running ? (
          <button className="px-4 py-2 text-sm rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200" onClick={() => postJson(`/api/jobs/${job.id}/cancel`, {})}>
            Cancel
          </button>
        ) : (
          <div className="flex gap-2">
            {job.mode !== 'copy' && <button className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white" onClick={onRescan}>Rescan</button>}
            <button className="px-4 py-2 text-sm rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200" onClick={onClose}>Close</button>
          </div>
        )}
      </div>

      <div>
        <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
          <div className={`h-full transition-all ${failed.length ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="flex justify-between text-xs text-slate-400 mt-1.5">
          <span>{formatBytes(done)} of {formatBytes(total)}</span>
          <span>
            {current ? `${current.status} ${current.id}${current.rate ? ` · ${current.rate}` : ''}` : ''}
            {' '}· {job.units.filter((u) => u.status === 'done').length}/{job.units.length} units
          </span>
        </div>
      </div>

      {!running && (
        <p className="text-sm text-slate-300">
          {cleanup
            ? `Freed ${formatBytes(done)} in ${job.units.filter((u) => u.status === 'done').length} project(s).`
            : `${job.units.filter((u) => u.status === 'done').length} unit(s) ${job.mode === 'move' ? 'moved' : 'backed up'}${job.verify ? ' and verified' : ''}.`}
          {failed.length ? ` ${failed.length} had problems — ${job.mode === 'move' ? 'their local copies were not touched.' : 'see below.'}` : ''}
          {job.manifest && <span className="block text-xs text-slate-500 font-mono mt-1">Manifest: {job.manifest}</span>}
        </p>
      )}

      {(failed.length > 0 || running) && (
        <ul className="max-h-72 overflow-y-auto divide-y divide-slate-800/60 text-sm">
          {(running ? job.units.filter((u) => u.status !== 'pending' || u === current) : failed).map((u) => (
            <li key={u.id} className="py-1.5">
              <div className="flex justify-between gap-3">
                <span className="font-mono text-slate-300 truncate">{u.id}</span>
                <span className={`${STATUS_STYLE[u.status]} whitespace-nowrap`}>{u.status}{u.status === 'copying' ? ` ${u.percent}%` : ''}</span>
              </div>
              {u.errors.length > 0 && (
                <pre className="text-xs text-red-300/80 whitespace-pre-wrap mt-1 max-h-32 overflow-y-auto">{u.errors.slice(0, 8).join('\n')}</pre>
              )}
              {u.mismatches.length > 0 && (
                <pre className="text-xs text-amber-300/80 whitespace-pre-wrap mt-1">Differs: {u.mismatches.slice(0, 8).join(', ')}</pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
