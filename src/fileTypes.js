// Extension -> category, for grouping the file-type panel.

const CATEGORIES = {
  audio: ['wav', 'flac', 'aiff', 'aif', 'mp3', 'm4a', 'ogg', 'opus', 'mid', 'midi', 'wma', 'aac'],
  video: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'flv'],
  images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg', 'ico', 'psd', 'ai', 'xcf', 'kra', 'exr', 'hdr', 'heic', 'raw', 'cr2', 'nef'],
  models: ['safetensors', 'gguf', 'ggml', 'ckpt', 'pt', 'pth', 'onnx', 'h5', 'keras', 'tflite', 'pb', 'npz', 'npy', 'bin', 'pkl', 'pickle', 'joblib', 'index'],
  archives: ['zip', 'tar', 'gz', 'tgz', '7z', 'rar', 'xz', 'bz2', 'iso', 'dmg', 'unitypackage'],
  '3d & game assets': ['blend', 'fbx', 'obj', 'glb', 'gltf', 'stl', 'dae', '3ds', 'max', 'asset', 'prefab', 'mat', 'unity', 'anim', 'controller', 'meta', 'tres', 'tscn'],
  data: ['csv', 'tsv', 'json', 'jsonl', 'parquet', 'arrow', 'feather', 'db', 'sqlite', 'sqlite3', 'xml', 'yaml', 'yml', 'hdf5', 'mat', 'log'],
  documents: ['md', 'txt', 'pdf', 'doc', 'docx', 'odt', 'rtf', 'ppt', 'pptx', 'xls', 'xlsx', 'ods', 'epub', 'tex'],
  binaries: ['exe', 'dll', 'so', 'dylib', 'o', 'a', 'lib', 'apk', 'aab', 'ipa', 'wasm', 'deb', 'rpm', 'appimage', 'msi', 'jar', 'class', 'pyd'],
  code: ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'ipynb', 'rs', 'go', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'java', 'kt', 'swift', 'rb', 'php', 'sh', 'lua', 'sql', 'html', 'css', 'scss', 'vue', 'svelte', 'gd', 'shader', 'glsl', 'hlsl', 'ino', 'toml', 'cfg', 'ini', 'kicad_pcb', 'kicad_sch', 'kicad_pro'],
};

const BY_EXT = new Map();
for (const [cat, exts] of Object.entries(CATEGORIES)) for (const e of exts) if (!BY_EXT.has(e)) BY_EXT.set(e, cat);

export const categoryOf = (ext) => BY_EXT.get(ext.slice(1)) ?? 'other';

// Categories the "skip big media & models" shortcut applies to.
export const BULKY_CATEGORIES = ['audio', 'video', 'models', 'archives'];

export const extOf = (p) => {
  const name = p.slice(p.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

const MB = 1024 * 1024;
export const RULE_OPTIONS = [
  ['keep', 'Keep'],
  [String(100 * MB), 'Skip files over 100 MB'],
  [String(10 * MB), 'Skip files over 10 MB'],
  [String(MB), 'Skip files over 1 MB'],
  ['all', 'Skip all'],
];
