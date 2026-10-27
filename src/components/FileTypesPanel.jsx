import { useMemo, useState } from 'react';
import { formatBytes } from '../api.js';
import { BULKY_CATEGORIES, categoryOf, RULE_OPTIONS } from '../fileTypes.js';

const MB = 1024 * 1024;
const toValue = (rule) => (rule === undefined ? 'keep' : String(rule));
const fromValue = (v) => (v === 'keep' ? undefined : v === 'all' ? 'all' : Number(v));

// How many bytes a rule would leave out for one extension across the selected units.
function skippedBy(rule, stat) {
  if (rule === 'all') return stat.bytes;
  if (typeof rule === 'number') return stat.big.filter((b) => b > rule).reduce((s, b) => s + b, 0);
  return 0;
}

function RuleSelect({ value, onChange, mixed }) {
  return (
    <select
      className="bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
      value={mixed ? 'mixed' : value}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
    >
      {mixed && <option value="mixed" disabled>Mixed</option>}
      {RULE_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}

export default function FileTypesPanel({ units, rules, setRule }) {
  const [open, setOpen] = useState(false);
  const [openCats, setOpenCats] = useState(new Set());

  // Extension stats over the selected units, grouped by category.
  const categories = useMemo(() => {
    const byExt = new Map();
    for (const u of units) {
      for (const [ext, e] of Object.entries(u.exts)) {
        if (!ext) continue; // files without an extension can't be matched by type
        const s = byExt.get(ext) ?? { ext, count: 0, bytes: 0, big: [] };
        s.count += e.count;
        s.bytes += e.bytes;
        byExt.set(ext, s);
      }
      for (const f of u.big) byExt.get(f.ext)?.big.push(f.bytes);
    }
    const cats = new Map();
    for (const s of byExt.values()) {
      const name = categoryOf(s.ext);
      const c = cats.get(name) ?? { name, count: 0, bytes: 0, exts: [] };
      c.count += s.count;
      c.bytes += s.bytes;
      c.exts.push(s);
      cats.set(name, c);
    }
    for (const c of cats.values()) c.exts.sort((a, b) => b.bytes - a.bytes);
    return [...cats.values()].sort((a, b) => b.bytes - a.bytes);
  }, [units]);

  const allExts = categories.flatMap((c) => c.exts);
  const skippedTotal = allExts.reduce((s, x) => s + skippedBy(rules[x.ext], x), 0);
  const activeCount = Object.keys(rules).length;

  const setCategory = (cat, v) => cat.exts.forEach((x) => setRule(x.ext, fromValue(v)));
  const skipBulky = () => categories
    .filter((c) => BULKY_CATEGORIES.includes(c.name))
    .forEach((c) => c.exts.forEach((x) => setRule(x.ext, 10 * MB)));
  const reset = () => allExts.forEach((x) => setRule(x.ext, undefined));
  const toggleCat = (name) => setOpenCats((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl">
      <div className="p-4 flex flex-wrap items-center gap-3">
        <button className="flex items-center gap-2 text-white font-medium" onClick={() => setOpen(!open)}>
          <span className={`text-slate-500 text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
          File types
        </button>
        <span className="text-sm text-slate-400">
          {activeCount ? <>Skipping <span className="text-amber-300 font-medium">{formatBytes(skippedTotal)}</span> by type</> : 'Everything kept'}
        </span>
        <div className="ml-auto flex gap-1 text-sm">
          <button className="px-2.5 py-1.5 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-amber-200" onClick={skipBulky}>
            Skip big media &amp; models (&gt;10 MB)
          </button>
          {activeCount > 0 && <button className="px-2.5 py-1.5 rounded-md hover:bg-slate-800 text-slate-300" onClick={reset}>Keep everything</button>}
        </div>
      </div>

      {open && (
        <div className="border-t border-slate-800 divide-y divide-slate-800/60">
          {categories.map((cat) => {
            const values = new Set(cat.exts.map((x) => toValue(rules[x.ext])));
            const skipped = cat.exts.reduce((s, x) => s + skippedBy(rules[x.ext], x), 0);
            const expanded = openCats.has(cat.name);
            return (
              <div key={cat.name}>
                <div className="px-4 py-2 flex items-center gap-3 hover:bg-slate-800/30 cursor-pointer" onClick={() => toggleCat(cat.name)}>
                  <span className={`text-slate-500 text-xs transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
                  <span className="text-sm text-slate-200 capitalize w-36">{cat.name}</span>
                  <span className="text-xs text-slate-500 hidden sm:inline">{cat.count.toLocaleString()} files · {cat.exts.length} types</span>
                  <span className="ml-auto text-sm text-slate-300 w-20 text-right">{formatBytes(cat.bytes)}</span>
                  <span className="text-xs text-amber-300/80 w-20 text-right">{skipped ? `−${formatBytes(skipped)}` : ''}</span>
                  <RuleSelect value={[...values][0]} mixed={values.size > 1} onChange={(v) => setCategory(cat, v)} />
                </div>
                {expanded && (
                  <ul className="pb-2">
                    {cat.exts.map((x) => {
                      const s = skippedBy(rules[x.ext], x);
                      return (
                        <li key={x.ext} className="pl-12 pr-4 py-1 flex items-center gap-3 text-sm">
                          <span className="font-mono text-slate-300 w-36 truncate">{x.ext}</span>
                          <span className="text-xs text-slate-500 hidden sm:inline">{x.count.toLocaleString()} files</span>
                          <span className="ml-auto text-slate-400 w-20 text-right">{formatBytes(x.bytes)}</span>
                          <span className="text-xs text-amber-300/80 w-20 text-right">{s ? `−${formatBytes(s)}` : ''}</span>
                          <RuleSelect value={toValue(rules[x.ext])} onChange={(v) => setRule(x.ext, fromValue(v))} />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
          <p className="px-4 py-2.5 text-xs text-slate-500">
            Applies to every selected unit; tick a single file inside a unit to keep it anyway. Rebuildable folders aren't counted here.
          </p>
        </div>
      )}
    </section>
  );
}
