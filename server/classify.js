// Rules that decide which folders are rebuildable (safe to leave out of a backup)
// and which files are "heavy" (large media / models / data the user may want to skip).
//
// Names alone are not enough: `Library` is only junk inside a Unity project, `target`
// only next to Cargo.toml, and a Python venv can be called anything — so most rules
// look at the folder's siblings (the parent's entries) or its own contents.

import { existsSync } from 'node:fs';
import path from 'node:path';

const has = (entries, ...names) => names.some((n) => entries.has(n));
const hasExt = (entries, ext) => [...entries].some((n) => n.endsWith(ext));

const isUnity = (e) => has(e, 'Assets') && has(e, 'ProjectSettings');
const isGodot = (e) => has(e, 'project.godot');
const isDotnet = (e) => hasExt(e, '.csproj') || hasExt(e, '.sln') || hasExt(e, '.fsproj');
const isJs = (e) => has(e, 'package.json');
const isPy = (e) => has(e, 'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt');
const isBuildable = (e) =>
  isJs(e) || isPy(e) || has(e, 'CMakeLists.txt', 'Makefile', 'meson.build', 'build.gradle', 'build.gradle.kts', 'pubspec.yaml');

// Folders that are caches anywhere they appear.
const ALWAYS_CACHE = new Set([
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.ipynb_checkpoints',
  '.tox', '.nox', '.parcel-cache', '.turbo', '.next', '.nuxt', '.svelte-kit',
  '.angular', '.dart_tool', '.gradle', '.nyc_output', '.eslintcache', '.sass-cache',
]);

/**
 * Classify a directory. Returns null for normal folders, or
 * { kind, label, rebuild } where kind is 'deps' | 'build' | 'cache'.
 * @param {string} name       folder name
 * @param {string} absPath    absolute path of the folder
 * @param {Set<string>} siblings names of entries in the parent folder
 */
export function classifyDir(name, absPath, siblings) {
  // Python virtualenvs are identified by pyvenv.cfg, whatever they're named.
  if (existsSync(path.join(absPath, 'pyvenv.cfg'))) {
    return { kind: 'deps', label: 'Python venv', rebuild: 'python-venv' };
  }
  if (existsSync(path.join(absPath, 'conda-meta'))) {
    return { kind: 'deps', label: 'Conda env', rebuild: 'conda-env' };
  }
  if (name === 'node_modules') {
    return { kind: 'deps', label: 'node_modules', rebuild: 'node' };
  }
  if (ALWAYS_CACHE.has(name) || name.endsWith('.egg-info')) {
    return { kind: 'cache', label: name, rebuild: 'auto' };
  }
  if (name === '.cache' || name === '.vite') {
    return { kind: 'cache', label: name, rebuild: 'auto' };
  }

  if (isUnity(siblings)) {
    if (name === 'Library') return { kind: 'deps', label: 'Unity Library', rebuild: 'unity' };
    if (['Temp', 'Obj', 'obj', 'Logs', 'Build', 'Builds'].includes(name)) {
      return { kind: 'build', label: `Unity ${name}`, rebuild: 'unity' };
    }
  }
  if (isGodot(siblings) && (name === '.godot' || name === '.import')) {
    return { kind: 'cache', label: `Godot ${name}`, rebuild: 'auto' };
  }
  if (name === 'target' && has(siblings, 'Cargo.toml', 'pom.xml')) {
    return { kind: 'build', label: has(siblings, 'Cargo.toml') ? 'Rust target' : 'Maven target', rebuild: 'build' };
  }
  if ((name === 'bin' || name === 'obj') && isDotnet(siblings)) {
    return { kind: 'build', label: `.NET ${name}`, rebuild: 'build' };
  }
  if (['dist', 'build', 'out', 'dist-ssr'].includes(name) && isBuildable(siblings)) {
    return { kind: 'build', label: `${name}/ output`, rebuild: 'build' };
  }
  if (name === 'coverage' && isJs(siblings)) {
    return { kind: 'build', label: 'coverage report', rebuild: 'build' };
  }
  return null;
}

// Files that mark a folder as the root of a project, mapped to a type tag.
const PROJECT_MARKERS = [
  ['.git', 'git'],
  ['package.json', 'node'],
  ['pyproject.toml', 'python'],
  ['setup.py', 'python'],
  ['requirements.txt', 'python'],
  ['Pipfile', 'python'],
  ['environment.yml', 'python'],
  ['Cargo.toml', 'rust'],
  ['go.mod', 'go'],
  ['pom.xml', 'java'],
  ['build.gradle', 'java'],
  ['CMakeLists.txt', 'c++'],
  ['platformio.ini', 'embedded'],
  ['project.godot', 'godot'],
];

export function detectProjectTypes(entries) {
  const types = new Set();
  for (const [marker, type] of PROJECT_MARKERS) if (entries.has(marker)) types.add(type);
  if (isUnity(entries)) types.add('unity');
  if (isDotnet(entries)) types.add('dotnet');
  if (hasExt(entries, '.kicad_pro') || (hasExt(entries, '.pro') && hasExt(entries, '.kicad_pcb'))) types.add('kicad');
  if (hasExt(entries, '.ino')) types.add('arduino');
  return [...types];
}

// Files worth flagging even when they live in normal folders.
const MODEL_EXTS = new Set(['.safetensors', '.gguf', '.ggml', '.ckpt', '.pt', '.pth', '.onnx', '.h5', '.keras', '.tflite', '.pb', '.npz', '.npy', '.bin']);
const MEDIA_EXTS = new Set(['.wav', '.flac', '.aiff', '.aif', '.mp3', '.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4a', '.ogg']);
const ARCHIVE_EXTS = new Set(['.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.xz', '.iso', '.dmg']);

export const HEAVY_FILE_BYTES = 50 * 1024 * 1024;
export const HEAVY_MODEL_BYTES = 10 * 1024 * 1024;

/** Returns a category ('model' | 'media' | 'archive' | 'large') or null. */
export function classifyHeavyFile(name, size) {
  const ext = path.extname(name).toLowerCase();
  if (MODEL_EXTS.has(ext) && size >= HEAVY_MODEL_BYTES) return 'model';
  if (size < HEAVY_FILE_BYTES) return null;
  if (MEDIA_EXTS.has(ext)) return 'media';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  return 'large';
}

/** Lower-case extension including the dot ('' for none; dotfiles like .env have none). */
export const extOf = (name) => path.extname(name).toLowerCase();

// Files that usually hold credentials. Templates (.env.example…) are not secrets.
const SECRET_NAMES = new Set(['.env', '.netrc', '.pypirc', '.npmrc', 'credentials.json', 'secrets.json', 'secrets.yaml', 'secrets.yml', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa']);
const SECRET_EXTS = new Set(['.pem', '.key', '.p12', '.pfx', '.keystore', '.jks', '.ppk']);
const TEMPLATE_SUFFIX = /\.(example|sample|template|dist|defaults?)$/i;

/** Returns 'env' | 'key' | 'credentials' or null. */
export function classifySecret(name) {
  if (TEMPLATE_SUFFIX.test(name)) return null;
  if (name === '.env' || name.startsWith('.env.') || name.endsWith('.env')) return 'env';
  if (SECRET_EXTS.has(extOf(name)) || /^id_(rsa|ed25519|ecdsa|dsa)$/.test(name)) return 'key';
  if (SECRET_NAMES.has(name) || /^(client_secret|service[-_]account).*\.json$/i.test(name)) return 'credentials';
  return null;
}
