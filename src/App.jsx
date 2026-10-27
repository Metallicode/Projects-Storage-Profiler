import { useEffect, useMemo, useRef, useState } from 'react';
import { formatBytes, getJson, postJson, streamScan, watchJob } from './api.js';
import { summarizeUnit, totals } from './plan.js';
import FolderPicker from './components/FolderPicker.jsx';
import UnitRow from './components/UnitRow.jsx';
import DestinationPanel from './components/DestinationPanel.jsx';
import JobPanel from './components/JobPanel.jsx';
import FileTypesPanel from './components/FileTypesPanel.jsx';
import SecretsNotice from './components/SecretsNotice.jsx';
import CleanupPanel from './components/CleanupPanel.jsx';
import { extOf } from './fileTypes.js';

const SEGMENTS = [
  ['work', 'Your work', 'bg-emerald-500', 'text-emerald-300'],
  ['git', 'Git history', 'bg-sky-500', 'text-sky-300'],
  ['heavy', 'Large media / models', 'bg-amber-500', 'text-amber-300'],
  ['rebuildable', 'Rebuildable (envs, deps, builds)', 'bg-purple-500', 'text-purple-300'],
];

export default function App() {
  const [root, setRoot] = useState('');
  const [scanState, setScanState] = useState('idle'); // idle | scanning | done | error
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [overrides, setOverrides] = useState({});
  const [rules, setRules] = useState({}); // file-type rules: { '.wav': 'all' | maxBytes }
  const [tab, setTab] = useState('backup'); // backup | cleanup
  const [filter, setFilter] = useState('');
  const [picker, setPicker] = useState(null); // 'root' | 'dest' | null
  const [dest, setDest] = useState('');
  const [job, setJob] = useState(null);
  const stopScan = useRef(null);

  useEffect(() => {
    getJson('/api/info').then((i) => setRoot(i.defaultRoot)).catch(() => setError('Cannot reach the local server. Start it with `npm run dev`.'));
  }, []);

  const startScan = (dir = root) => {
    stopScan.current?.();
    setScanState('scanning');
    setError('');
    setProgress(null);
    stopScan.current = streamScan(dir, {
      onProgress: setProgress,
      onDone: (r) => {
        setResult(r);
        setSelected(new Set(r.units.map((u) => u.id)));
        setOverrides({});
        setScanState('done');
      },
      onFailed: (msg) => { setError(msg); setScanState('error'); },
    });
  };

  const cancelScan = () => { stopScan.current?.(); setScanState(result ? 'done' : 'idle'); };

  const choices = useMemo(() => ({ overrides, rules }), [overrides, rules]);
  const summaries = useMemo(
    () => new Map((result?.units ?? []).map((u) => [u.id, summarizeUnit(u, choices)])),
    [result, choices],
  );
  const all = useMemo(() => totals(result?.units ?? []), [result]);

  const chosen = result?.units.filter((u) => selected.has(u.id)) ?? [];
  const copyBytes = chosen.reduce((s, u) => s + summaries.get(u.id).copyBytes, 0);
  const lossyCount = chosen.filter((u) => summaries.get(u.id).lossy.length).length;
  const secrets = chosen.flatMap((u) => u.secrets);
  const secretsOut = secrets.filter((x) => overrides[x.path] === false).length;

  const needle = filter.trim().toLowerCase();
  const visible = (result?.units ?? []).filter((u) => !needle || u.id.toLowerCase().includes(needle) || u.types.some((t) => t.includes(needle)));

  const setMany = (units, on) => setSelected((s) => {
    const next = new Set(s);
    units.forEach((u) => (on ? next.add(u.id) : next.delete(u.id)));
    return next;
  });

  // A new file-type choice wins over per-file ticks made earlier for that type.
  const setRule = (ext, rule) => {
    setRules((r) => {
      const next = { ...r };
      if (rule === undefined) delete next[ext];
      else next[ext] = rule;
      return next;
    });
    setOverrides((o) => Object.fromEntries(Object.entries(o).filter(([p]) => extOf(p) !== ext)));
  };

  const setSecrets = (include) => setOverrides((o) => ({ ...o, ...Object.fromEntries(secrets.map((x) => [x.path, include])) }));

  const startBackup = async ({ mode, verify }) => {
    try {
      const { id } = await postJson('/api/backup', {
        root: result.root,
        dest,
        mode,
        verify,
        skipExts: Object.keys(rules).filter((ext) => rules[ext] === 'all'),
        units: chosen.map((u) => {
          const s = summaries.get(u.id);
          return { id: u.id, exclude: s.exclude, include: s.include, estimate: s.copyBytes };
        }),
      });
      watchJob(id, setJob);
    } catch (e) {
      setError(e.message);
    }
  };

  const startCleanup = async (items) => {
    try {
      const { id } = await postJson('/api/cleanup', { root: result.root, items });
      watchJob(id, setJob);
    } catch (e) {
      setError(e.message);
    }
  };

  const jobRunning = job && ['pending', 'running'].includes(job.status);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Project Storage Profiler</h1>
            <p className="text-slate-400 mt-1">Back up your work — not the venvs, node_modules and build folders around it.</p>
          </div>
          <div className="flex gap-2 w-full lg:w-auto">
            <button
              className="flex-1 lg:w-96 text-left bg-slate-900 border border-slate-700 hover:border-slate-500 rounded-lg px-3 py-2.5 text-sm font-mono truncate"
              onClick={() => setPicker('root')}
              disabled={scanState === 'scanning' || jobRunning}
              title={root}
            >
              {root || '…'}
            </button>
            {scanState === 'scanning' ? (
              <button className="px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white" onClick={cancelScan}>Stop</button>
            ) : (
              <button
                className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-40"
                disabled={!root || jobRunning}
                onClick={() => startScan()}
              >
                {result ? 'Rescan' : 'Scan'}
              </button>
            )}
          </div>
        </header>

        {error && <div className="bg-red-500/10 border border-red-500/40 text-red-300 p-4 rounded-lg text-sm">{error}</div>}

        {scanState === 'scanning' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center gap-3 text-white">
              <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              Scanning… {progress && <span className="text-slate-400">{progress.files.toLocaleString()} files · {formatBytes(progress.bytes)}</span>}
            </div>
            <p className="text-xs font-mono text-slate-500 mt-2 truncate">{progress?.dir}</p>
          </div>
        )}

        {scanState === 'idle' && !result && !error && (
          <div className="border-2 border-dashed border-slate-800 rounded-2xl p-12 text-center text-slate-400">
            Pick the folder that holds your projects and press <span className="text-white">Scan</span>.
            Nothing is copied or changed until you start a backup.
          </div>
        )}

        {result && (
          <>
            <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                <h3 className="text-lg font-medium text-white">{formatBytes(all.total)} in {result.units.length} units</h3>
                <span className="text-sm text-slate-400">
                  Your work + history is <span className="text-emerald-300 font-semibold">{formatBytes(all.work + all.git)}</span> —{' '}
                  {all.total ? Math.round(((all.work + all.git) / all.total) * 100) : 0}% of it
                </span>
              </div>
              <div className="h-6 bg-slate-800 rounded-full overflow-hidden flex">
                {SEGMENTS.map(([key, label, bg]) => (
                  <div key={key} className={`${bg} h-full`} style={{ width: `${(all[key] / (all.total || 1)) * 100}%` }} title={`${label}: ${formatBytes(all[key])}`} />
                ))}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                {SEGMENTS.map(([key, label, bg, text]) => (
                  <div key={key}>
                    <div className="flex items-center gap-2 text-xs text-slate-400"><span className={`w-2.5 h-2.5 rounded-full ${bg}`} />{label}</div>
                    <div className={`text-xl font-semibold ${text}`}>{formatBytes(all[key])}</div>
                  </div>
                ))}
              </div>
            </section>

            <nav className="flex gap-1 border-b border-slate-800">
              {[['backup', 'Back up'], ['cleanup', 'Free up space']].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 ${tab === key ? 'border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
                >
                  {label}
                  {key === 'cleanup' && <span className="ml-2 text-xs text-purple-300">{formatBytes(all.rebuildable)}</span>}
                </button>
              ))}
            </nav>

            {job && <JobPanel job={job} onClose={() => setJob(null)} onRescan={() => { setJob(null); startScan(); }} />}

            {tab === 'cleanup' && (
              <CleanupPanel key={result.scannedAt} units={result.units} busy={Boolean(job) || scanState === 'scanning'} onStart={startCleanup} />
            )}

            {tab === 'backup' && !job && (
              <DestinationPanel
                copyBytes={copyBytes}
                unitCount={chosen.length}
                lossyCount={lossyCount}
                dest={dest}
                setDest={setDest}
                busy={scanState === 'scanning'}
                onBrowse={() => setPicker('dest')}
                onStart={startBackup}
              />
            )}

            {tab === 'backup' && <>
            <SecretsNotice secrets={secrets} excludedCount={secretsOut} onSetAll={setSecrets} />
            <FileTypesPanel units={chosen} rules={rules} setRule={setRule} />

            <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-800">
                <input
                  className="flex-1 min-w-48 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  placeholder="Filter by path or type (unity, python…)"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <div className="flex gap-1 text-sm">
                  <button className="px-2.5 py-1.5 rounded-md hover:bg-slate-800 text-slate-300" onClick={() => setMany(visible, true)}>Select {needle ? 'shown' : 'all'}</button>
                  <button className="px-2.5 py-1.5 rounded-md hover:bg-slate-800 text-slate-300" onClick={() => setMany(visible, false)}>None</button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full table-fixed">
                  <colgroup>
                    <col className="w-10" /><col /><col className="w-28" /><col className="w-28 hidden md:table-column" /><col className="w-28" />
                  </colgroup>
                  <thead className="text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th />
                      <th className="text-left py-2 font-semibold">Unit</th>
                      <th className="text-right py-2 px-3 font-semibold">On disk</th>
                      <th className="text-right py-2 px-3 font-semibold hidden md:table-cell">Left out</th>
                      <th className="text-right py-2 px-3 pr-4 font-semibold">To copy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((u) => (
                      <UnitRow
                        key={u.id}
                        unit={u}
                        summary={summaries.get(u.id)}
                        selected={selected.has(u.id)}
                        onSelect={(on) => setMany([u], on)}
                        choices={choices}
                        setOverrides={setOverrides}
                      />
                    ))}
                  </tbody>
                </table>
                {!visible.length && <p className="p-6 text-center text-slate-500 text-sm">No units match.</p>}
              </div>
            </section>
            </>}
          </>
        )}
      </div>

      {picker && (
        <FolderPicker
          title={picker === 'root' ? 'Folder to scan' : 'Backup destination'}
          start={picker === 'root' ? root : dest.replace(/\/ProjectBackups$/, '')}
          onClose={() => setPicker(null)}
          onPick={(p) => {
            setPicker(null);
            if (picker === 'root') { setRoot(p); setResult(null); startScan(p); } else setDest(p);
          }}
        />
      )}
    </div>
  );
}
