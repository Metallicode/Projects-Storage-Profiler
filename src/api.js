// Thin client for the local server in server/index.js.

export async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

export async function postJson(url, data) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

/** Stream a scan; returns a function that cancels it. */
export function streamScan(root, { onProgress, onDone, onFailed }) {
  const es = new EventSource(`/api/scan?root=${encodeURIComponent(root)}`);
  es.addEventListener('progress', (e) => onProgress(JSON.parse(e.data)));
  es.addEventListener('done', (e) => { es.close(); onDone(JSON.parse(e.data)); });
  es.addEventListener('failed', (e) => { es.close(); onFailed(JSON.parse(e.data).message); });
  es.onerror = () => { es.close(); onFailed('Lost connection to the local server.'); };
  return () => es.close();
}

/** Follow a backup job until it finishes; returns a function that stops listening. */
export function watchJob(id, onUpdate) {
  const es = new EventSource(`/api/jobs/${id}/events`);
  es.addEventListener('job', (e) => {
    const job = JSON.parse(e.data);
    onUpdate(job);
    if (!['pending', 'running'].includes(job.status)) es.close();
  });
  es.onerror = () => es.close();
  return () => es.close();
}

export function formatBytes(bytes, decimals = 1) {
  if (!+bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / k ** i).toFixed(i ? decimals : 0))} ${sizes[i]}`;
}
