import { useEffect, useState } from 'react';
import { getJson } from '../api.js';

export default function FolderPicker({ title, start, onPick, onClose }) {
  const [listing, setListing] = useState(null);
  const [error, setError] = useState('');
  const [typed, setTyped] = useState(start || '');

  const open = (p) => {
    setError('');
    getJson(`/api/ls?path=${encodeURIComponent(p)}`)
      .then((l) => { setListing(l); setTyped(l.path); })
      .catch((e) => setError(e.message));
  };

  useEffect(() => { open(start || ''); }, [start]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-xl max-h-[80vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-800">
          <h3 className="text-white font-medium mb-3">{title}</h3>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); open(typed); }}>
            <input
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-200 focus:outline-none focus:border-blue-500"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            <button className="px-3 py-2 text-sm rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200">Go</button>
          </form>
          {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
        </div>
        <div className="overflow-y-auto flex-1 py-1">
          {listing?.parent && (
            <button className="w-full text-left px-4 py-1.5 text-sm text-slate-400 hover:bg-slate-800" onClick={() => open(listing.parent)}>
              ↑ ..
            </button>
          )}
          {listing?.dirs.map((d) => (
            <button
              key={d}
              className="w-full text-left px-4 py-1.5 text-sm text-slate-200 hover:bg-slate-800 flex items-center gap-2"
              onClick={() => open(`${listing.path}/${d}`)}
            >
              <span className="text-slate-500">▸</span> {d}
            </button>
          ))}
          {listing && !listing.dirs.length && <p className="px-4 py-3 text-sm text-slate-500">No subfolders.</p>}
        </div>
        <div className="p-4 border-t border-slate-800 flex justify-end gap-2">
          <button className="px-4 py-2 text-sm rounded-lg text-slate-300 hover:bg-slate-800" onClick={onClose}>Cancel</button>
          <button
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
            disabled={!listing}
            onClick={() => onPick(listing.path)}
          >
            Use this folder
          </button>
        </div>
      </div>
    </div>
  );
}
