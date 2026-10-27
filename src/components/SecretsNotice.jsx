import { useState } from 'react';

// Warns that .env files / keys in the selection will land on an unencrypted drive.
export default function SecretsNotice({ secrets, excludedCount, onSetAll }) {
  const [show, setShow] = useState(false);
  if (!secrets.length) return null;
  const allOut = excludedCount === secrets.length;

  return (
    <section className={`rounded-xl border p-4 ${allOut ? 'border-slate-800 bg-slate-900' : 'border-rose-500/40 bg-rose-500/5'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-64">
          <p className="text-sm text-white font-medium">
            {secrets.length} secret file{secrets.length === 1 ? '' : 's'} in your selection
            {allOut ? ' — left out of this backup' : excludedCount ? ` — ${excludedCount} left out` : ''}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            {allOut
              ? 'Your projects may need them to run; keep your own copy of the important ones somewhere safe.'
              : '.env files, keys and credentials are copied as plain files — anyone holding the drive can read them.'}
          </p>
        </div>
        <button className="text-xs text-slate-400 hover:text-white" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'} files</button>
        <button
          className={`px-3 py-1.5 text-sm rounded-md ${allOut ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-200'}`}
          onClick={() => onSetAll(allOut)}
        >
          {allOut ? 'Include secrets' : 'Leave secrets out'}
        </button>
      </div>
      {show && (
        <ul className="mt-3 max-h-48 overflow-y-auto text-xs font-mono text-slate-300 space-y-0.5">
          {secrets.map((s) => (
            <li key={s.path} className="flex gap-2"><span className="text-rose-300/70 w-20 shrink-0">{s.kind}</span>{s.path}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
