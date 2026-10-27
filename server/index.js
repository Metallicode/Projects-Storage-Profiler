// Local server for Storage Profiler: real filesystem access for the React UI.
//   node server/index.js         serve the built UI from dist/
//   node server/index.js --dev   serve the UI through Vite with hot reload

import http from 'node:http';
import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from './scan.js';
import { listDrives } from './drives.js';
import { createJob, runJob, snapshot, cancelJob } from './backup.js';
import { createCleanupJob, runCleanupJob } from './cleanup.js';

const PORT = Number(process.env.PORT) || 5175;
const DEV = process.argv.includes('--dev');
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const scans = new Map(); // root -> last scan result (backup plans are validated against it)
const jobs = new Map();

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function openEvents(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  return send;
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10 << 20) throw new Error('Request too large');
  }
  return JSON.parse(body || '{}');
}

const defaultRoot = () => {
  const projects = path.join(os.homedir(), 'Documents', 'Projects');
  return existsSync(projects) ? projects : os.homedir();
};

const routes = {
  'GET /api/info': async (req, res) => sendJson(res, 200, { home: os.homedir(), defaultRoot: defaultRoot() }),

  'GET /api/drives': async (req, res) => sendJson(res, 200, await listDrives()),

  // Folder browser for picking the scan root or a destination folder.
  'GET /api/ls': async (req, res, url) => {
    const dir = path.resolve(url.searchParams.get('path') || defaultRoot());
    const entries = await readdir(dir, { withFileTypes: true });
    const dirs = entries
      .filter((d) => d.isDirectory() && (url.searchParams.has('hidden') || !d.name.startsWith('.')))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
    sendJson(res, 200, { path: dir, parent: path.dirname(dir) === dir ? null : path.dirname(dir), dirs });
  },

  'GET /api/scan': async (req, res, url) => {
    const send = openEvents(req, res);
    const signal = { cancelled: false };
    req.on('close', () => { signal.cancelled = true; });
    try {
      const root = await realpath(path.resolve(url.searchParams.get('root') || defaultRoot()));
      if (!(await stat(root)).isDirectory()) throw new Error('Not a folder');
      const result = await scan(root, (p) => send('progress', p), signal);
      if (!signal.cancelled) {
        scans.set(root, result);
        send('done', result);
      }
    } catch (err) {
      send('failed', { message: err.message });
    }
    res.end();
  },

  'POST /api/backup': async (req, res) => {
    const plan = await readBody(req);
    const scanResult = scans.get(plan.root);
    if (!scanResult) return sendJson(res, 400, { error: 'Scan this folder first.' });
    if ([...jobs.values()].some((j) => j.status === 'running')) {
      return sendJson(res, 409, { error: 'A backup is already running.' });
    }
    try {
      const job = await createJob(scanResult, plan);
      jobs.set(job.id, job);
      runJob(job).then(() => {
        // Moved projects changed on disk; force a rescan before another plan.
        if (job.mode === 'move') scans.delete(plan.root);
      });
      sendJson(res, 200, { id: job.id });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  },

  'POST /api/cleanup': async (req, res) => {
    const plan = await readBody(req);
    const scanResult = scans.get(plan.root);
    if (!scanResult) return sendJson(res, 400, { error: 'Scan this folder first.' });
    if ([...jobs.values()].some((j) => j.status === 'running')) {
      return sendJson(res, 409, { error: 'Another job is already running.' });
    }
    try {
      const job = createCleanupJob(scanResult, plan);
      jobs.set(job.id, job);
      runCleanupJob(job).then(() => scans.delete(plan.root));
      sendJson(res, 200, { id: job.id });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  },
};

async function jobRoute(req, res, url) {
  const m = url.pathname.match(/^\/api\/jobs\/([\w-]+)\/(events|cancel)$/);
  const job = m && jobs.get(m[1]);
  if (!job) return sendJson(res, 404, { error: 'No such job' });

  if (m[2] === 'cancel' && req.method === 'POST') {
    cancelJob(job);
    return sendJson(res, 200, { ok: true });
  }
  const send = openEvents(req, res);
  const tick = () => {
    send('job', snapshot(job));
    if (!['pending', 'running'].includes(job.status)) {
      clearInterval(timer);
      res.end();
    }
  };
  const timer = setInterval(tick, 500);
  req.on('close', () => clearInterval(timer));
  tick();
}

let vite = null;
if (DEV) {
  const { createServer } = await import('vite');
  vite = await createServer({ root: APP_DIR, server: { middlewareMode: true }, appType: 'spa' });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

async function serveStatic(req, res, url) {
  const dist = path.join(APP_DIR, 'dist');
  let file = path.join(dist, path.normalize(decodeURIComponent(url.pathname)));
  if (!file.startsWith(dist) || !existsSync(file) || (await stat(file)).isDirectory()) file = path.join(dist, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    return res.end('UI not built. Run `npm run build` or start with `npm run dev`.');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(await readFile(file));
}

const server = http.createServer(async (req, res) => {
  // This server can delete files: only answer pages served from localhost (blocks DNS rebinding).
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  // …and refuse writes triggered by other websites (CSRF): same-origin JSON requests only.
  if (req.method !== 'GET') {
    const origin = req.headers.origin;
    const sameOrigin = !origin || new URL(origin).host === req.headers.host;
    if (!sameOrigin || !String(req.headers['content-type']).startsWith('application/json')) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/jobs/')) return await jobRoute(req, res, url);
    const route = routes[`${req.method} ${url.pathname}`];
    if (route) return await route(req, res, url);
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
    if (vite) return vite.middlewares(req, res);
    return await serveStatic(req, res, url);
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
    else res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Storage Profiler running at http://localhost:${PORT}`);
});
