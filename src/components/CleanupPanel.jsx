import { useMemo, useState } from 'react';
import { formatBytes } from '../api.js';
import { timeAgo } from '../plan.js';

const DAY = 864e5;
const PRESETS = [
  ['Untouched 6+ months', (i) => i.lastModified && Date.now() - i.lastModified > 182 * DAY],
  ['Untouched 1+ year', (i) => i.lastModified && Date.now() - i.lastModified > 365 * DAY],
  ['Caches only', (i) => i.kind === 'cache'],
  ['Everything', () => true],
];
const PAGE = 60;

export default function CleanupPanel({ units, onStart, busy }) {
  // Every rebuildable folder, with the age of the project around it.
  const items = useMemo(() => units
    .flatMap((u) => u.excluded.map((e) => ({ ...e, unitPath: u.path || '.', unitName: u.name, lastModified: u.lastModified })))
    .filter((i) => i.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes), [units]);

  const [selected, setSelected] = useState(() => new Set(items.filter(PRESETS[0][1]).map((i) => i.path)));
  const [showAll, setShowAll] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const chosen = items.filter((i) => selected.has(i.path));
  const chosenBytes = chosen.reduce((s, i) => s + i.bytes, 0);
  const staleBytes = items.filter(PRESETS[0][1]).reduce((s, i) => s + i.bytes, 0);
  const venvCount = chosen.filter((i) => i.rebuild === 'python-venv').length;

  const toggle = (path, on) => setSelected((s) => { const n = new Set(s); if (on) n.add(path); else n.delete(path); return n; });
  const visible = showAll ? items : items.slice(0, PAGE);

  return (
    <div className="space-y-4">
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-lg font-medium text-white">Free up space on this computer</h3>
          <p className="text-sm text-slate-400 mt-1">
            Deletes environments, dependencies and build output — nothing you wrote. A <span className="font-mono text-slate-300">.rebuild-notes/</span> file
            is saved in each project first, with the exact package list for every venv.{' '}
            <span className="text-purple-300">{formatBytes(staleBytes)}</span> sits in projects you haven't touched for 6+ months.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5 text-sm">
          {PRESETS.map(([label, test]) => (
            <button key={label} className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200" onClick={() => setSelected(new Set(items.filter(test).map((i) => i.path)))}>
              {label}
            </button>
          ))}
          <button className="px-3 py-1.5 rounded-md hover:bg-slate-800 text-slate-400" onClick={() => setSelected(new Set())}>None</button>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="text-sm text-slate-400">
            <span className="text-white font-semibold text-lg">{formatBytes(chosenBytes)}</span> in {chosen.length} folder{chosen.length === 1 ? '' : 's'}
          </div>
          <button
            disabled={!chosen.length || busy}
            onClick={() => setConfirming(true)}
            className="px-6 py-2.5 rounded-lg font-medium text-white bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Delete {chosen.length} folder{chosen.length === 1 ? '' : 's'}
          </button>
        </div>
      </section>

      <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <colgroup><col className="w-10" /><col /><col className="w-28" /><col className="w-24 hidden sm:table-column" /></colgroup>
          <thead className="text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th />
              <th className="text-left py-2 font-semibold">Folder</th>
              <th className="text-right py-2 px-3 font-semibold">Size</th>
              <th className="text-right py-2 px-3 pr-4 font-semibold hidden sm:table-cell">Project edited</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((i) => (
              <tr key={i.path} className="border-t border-slate-800/60 hover:bg-slate-800/30">
                <td className="pl-4 py-2">
                  <input type="checkbox" className="w-4 h-4 accent-red-500 cursor-pointer" checked={selected.has(i.path)} onChange={(e) => toggle(i.path, e.target.checked)} />
                </td>
                <td className="py-2 pr-3 min-w-0">
                  <span className="block font-mono text-slate-200 truncate" title={i.path}>{i.path}</span>
                  <span className="text-xs text-purple-300/80">{i.label}{i.detail ? ` · ${i.detail}` : ''}</span>
                </td>
                <td className="py-2 px-3 text-right text-slate-200 whitespace-nowrap">{formatBytes(i.bytes)}</td>
                <td className="py-2 px-3 pr-4 text-right text-slate-400 whitespace-nowrap hidden sm:table-cell">{timeAgo(i.lastModified)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length > PAGE && !showAll && (
          <button className="w-full py-2.5 text-sm text-slate-400 hover:text-white border-t border-slate-800" onClick={() => setShowAll(true)}>
            Show all {items.length} folders
          </button>
        )}
        {!items.length && <p className="p-6 text-center text-slate-500">No rebuildable folders found.</p>}
      </section>

      {confirming && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setConfirming(false)}>
          <div className="bg-slate-900 border border-red-500/40 rounded-xl max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white text-lg font-medium">Delete {chosen.length} folders ({formatBytes(chosenBytes)})?</h3>
            <p className="text-sm text-slate-300">
              They're removed from this computer for good. Each project gets <span className="font-mono">.rebuild-notes/REBUILD.md</span> with
              the commands to recreate them{venvCount ? `, plus the package list of all ${venvCount} venv${venvCount === 1 ? '' : 's'}` : ''}.
            </p>
            <p className="text-sm text-slate-400">A venv whose packages can't be recorded is kept. Each folder is re-checked right before it's deleted.</p>
            <div className="flex justify-end gap-2">
              <button className="px-4 py-2 text-sm rounded-lg text-slate-300 hover:bg-slate-800" onClick={() => setConfirming(false)}>Cancel</button>
              <button className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white" onClick={() => { setConfirming(false); onStart(chosen.map((i) => i.path)); }}>
                Delete and free {formatBytes(chosenBytes)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
