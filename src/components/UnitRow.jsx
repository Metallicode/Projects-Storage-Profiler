import { useState } from 'react';
import { formatBytes } from '../api.js';
import { isIncluded, KIND_LABEL, timeAgo } from '../plan.js';

const TYPE_STYLE = {
  rebuildable: 'text-purple-300',
  heavy: 'text-amber-300',
  git: 'text-sky-300',
  secret: 'text-rose-300',
};

const relTo = (unit, p) => (unit.path ? p.slice(unit.path.length + 1) : p) || '.';
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.');

// Large files are grouped by folder so a render dump of 40 WAVs is one toggle.
function groupHeavy(items, unit) {
  const groups = new Map();
  for (const item of items) {
    const dir = parentOf(relTo(unit, item.path));
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(item);
  }
  return [...groups.entries()].map(([dir, files]) => ({ dir, files, bytes: files.reduce((s, f) => s + f.bytes, 0) }));
}

function Check({ checked, indeterminate, onChange, title }) {
  return (
    <input
      type="checkbox"
      title={title}
      className="w-4 h-4 accent-blue-500 cursor-pointer shrink-0"
      checked={checked}
      ref={(el) => el && (el.indeterminate = Boolean(indeterminate))}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

export default function UnitRow({ unit, summary, selected, onSelect, choices, setOverrides }) {
  const [open, setOpen] = useState(false);
  const setItems = (items, value) =>
    setOverrides((o) => ({ ...o, ...Object.fromEntries(items.map((i) => [i.path, value])) }));

  const rebuildable = summary.items.filter((i) => i.type === 'rebuildable' || i.type === 'git');
  const secrets = summary.items.filter((i) => i.type === 'secret');
  const ignoredBytes = unit.ignored.reduce((s, i) => s + i.bytes, 0);
  const heavyGroups = groupHeavy(summary.items.filter((i) => i.type === 'heavy'), unit);
  const saved = unit.totalBytes - summary.copyBytes;

  return (
    <>
      <tr className={`border-t border-slate-800/60 hover:bg-slate-800/30 ${selected ? '' : 'opacity-50'}`}>
        <td className="pl-4 py-2.5 w-8"><Check checked={selected} onChange={onSelect} /></td>
        <td className="py-2.5 pr-3">
          <button className="flex items-center gap-2 text-left w-full min-w-0" onClick={() => setOpen(!open)}>
            <span className={`text-slate-500 text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
            <span className="min-w-0">
              <span className="block text-slate-200 text-sm font-mono truncate" title={unit.path || '.'}>{unit.path || '.'}</span>
              <span className="flex flex-wrap gap-1 mt-0.5">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">{KIND_LABEL[unit.kind]}</span>
                {unit.types.map((t) => (
                  <span key={t} className="text-[10px] px-1.5 rounded bg-slate-800 text-slate-400">{t}</span>
                ))}
                {summary.lossy.length > 0 && <span className="text-[10px] px-1.5 rounded bg-amber-500/15 text-amber-300">files skipped</span>}
                {unit.secrets.length > 0 && <span className="text-[10px] px-1.5 rounded bg-rose-500/15 text-rose-300">{unit.secrets.length} secret{unit.secrets.length === 1 ? '' : 's'}</span>}
                {ignoredBytes > 0 && <span className="text-[10px] px-1.5 rounded bg-sky-500/10 text-sky-300" title="Git-ignored, so not on any remote — this backup is the only other copy">{formatBytes(ignoredBytes)} not in git</span>}
                <span className="text-[10px] text-slate-600">edited {timeAgo(unit.lastModified)}</span>
              </span>
            </span>
          </button>
        </td>
        <td className="py-2.5 px-3 text-right text-sm text-slate-400 whitespace-nowrap">{formatBytes(unit.totalBytes)}</td>
        <td className="py-2.5 px-3 text-right text-sm text-purple-300/80 whitespace-nowrap hidden md:table-cell">{saved ? `−${formatBytes(saved)}` : '—'}</td>
        <td className="py-2.5 px-3 pr-4 text-right text-sm text-white font-medium whitespace-nowrap">{formatBytes(summary.copyBytes)}</td>
      </tr>
      {open && (
        <tr className="bg-slate-950/60">
          <td />
          <td colSpan={4} className="pb-3 pr-4">
            {!summary.items.length && !unit.ignored.length && <p className="text-sm text-slate-500 py-2">Nothing to leave out — this whole unit is your work ({unit.files.toLocaleString()} files).</p>}
            <ul className="space-y-1 py-1">
              {rebuildable.map((item) => (
                <li key={item.path} className="flex items-center gap-3 text-sm">
                  <Check checked={isIncluded(item, choices)} onChange={(v) => setItems([item], v)} title="Include in backup" />
                  <span className="font-mono text-slate-300 truncate">{relTo(unit, item.path)}/</span>
                  <span className={`text-xs ${TYPE_STYLE[item.type]}`}>{item.label}{item.detail ? ` · ${item.detail}` : ''}</span>
                  <span className="ml-auto text-slate-400 whitespace-nowrap">{formatBytes(item.bytes)}</span>
                </li>
              ))}
              {heavyGroups.map((g) => {
                const on = g.files.filter((f) => isIncluded(f, choices)).length;
                return (
                  <li key={g.dir} className="flex items-center gap-3 text-sm">
                    <Check checked={on === g.files.length} indeterminate={on > 0 && on < g.files.length} onChange={(v) => setItems(g.files, v)} title="Include in backup" />
                    <span className="font-mono text-slate-300 truncate" title={g.files.map((f) => relTo(unit, f.path)).join('\n')}>
                      {g.files.length === 1 ? relTo(unit, g.files[0].path) : `${g.dir}/ — ${g.files.length} large files`}
                    </span>
                    <span className={`text-xs ${TYPE_STYLE.heavy}`}>{[...new Set(g.files.map((f) => f.label))].join(', ')}</span>
                    <span className="ml-auto text-slate-400 whitespace-nowrap">{formatBytes(g.bytes)}</span>
                  </li>
                );
              })}
            </ul>
            {secrets.length > 0 && (
              <ul className="space-y-1 py-1">
                {secrets.map((item) => (
                  <li key={item.path} className="flex items-center gap-3 text-sm">
                    <Check checked={isIncluded(item, choices)} onChange={(v) => setItems([item], v)} title="Include in backup" />
                    <span className="font-mono text-slate-300 truncate">{relTo(unit, item.path)}</span>
                    <span className={`text-xs ${TYPE_STYLE.secret}`}>{item.label} · stored unencrypted</span>
                  </li>
                ))}
              </ul>
            )}
            {summary.typeSkippedFiles > 0 && (
              <p className="text-xs text-amber-300/80 mt-1">
                File types: {summary.typeSkippedFiles.toLocaleString()} file(s), {formatBytes(summary.typeSkippedBytes)} left out by your file-type choices.
              </p>
            )}
            {unit.ignored.length > 0 && (
              <div className="mt-2">
                <p className="text-xs text-sky-300/90">Git-ignored — not on any remote, so keep it backed up:</p>
                <ul className="mt-1 text-xs font-mono text-slate-400 space-y-0.5">
                  {unit.ignored.slice(0, 8).map((i) => (
                    <li key={i.path} className="flex gap-3"><span className="truncate">{relTo(unit, i.path)}{i.dir ? '/' : ''}</span><span className="ml-auto whitespace-nowrap">{formatBytes(i.bytes)}</span></li>
                  ))}
                  {unit.ignored.length > 8 && <li className="text-slate-600">…and {unit.ignored.length - 8} more</li>}
                </ul>
              </div>
            )}
            {unit.symlinks.length > 0 && (
              <p className="text-xs text-slate-500 mt-2">{unit.symlinks.length} symlink(s) — listed in the restore notes if the drive can't store them.</p>
            )}
            {unit.errors.length > 0 && (
              <p className="text-xs text-red-400/80 mt-1" title={unit.errors.join('\n')}>{unit.errors.length} unreadable path(s) during scan.</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
