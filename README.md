# Storage Profiler

Back up or archive your projects to an external drive **without** the venvs, `node_modules`,
Unity `Library`, Rust `target`, build output, caches and downloaded models around them.

Most projects are small; what makes them huge is the stuff that can be rebuilt. This tool scans a
folder of projects, shows where the space goes, and copies (or moves) only what matters to a drive,
leaving notes on how to rebuild the rest. It can also delete the rebuildable folders locally to free
up space.

It's meant to be used once in a while with a couple of clicks: nothing to configure, nothing saved
between runs.

---

## Requirements

- **Linux** (uses `du`, `statfs` and drives mounted under `/media`, `/run/media` or `/mnt`)
- **Node.js 20+** (tested on 22)
- **rsync** 3.1+ (`sudo apt install rsync`)
- **git** (optional, for the "not in git" hints)
- **Python** (optional, to record `pip freeze` of venvs that are left out)

## Running it

```bash
npm install        # first time only
npm start          # build the UI and open the server at http://localhost:5175
```

Then open **http://localhost:5175** in your browser. Stop it with `Ctrl+C`.

For working on the tool itself:

```bash
npm run dev        # same server, with hot reload of the UI
npm run lint
```

The server only listens on `127.0.0.1` and rejects requests from other sites, so nothing else on
your network (or a web page you have open) can trigger a copy or delete.

---

## How to use it

### 1. Scan

Pick the folder that holds your projects (default `~/Documents/Projects`) and press **Scan**.
It's split into units:

| Unit | What it is |
|---|---|
| **Project** | A folder with project markers: `.git`, `package.json`, `pyproject.toml`, Unity `Assets` + `ProjectSettings`, `Cargo.toml`, … Nested projects belong to it. |
| **Folder** | A subtree with no projects in it. |
| **Loose files** | Files sitting directly next to project folders. |

Each unit shows its size, what would be copied, when it was last edited, and badges for secrets
and git-ignored files.

### 2. Choose what to leave out

Per unit, open the details to see and toggle:

- **Rebuildable** (left out by default): Python venvs (found by `pyvenv.cfg`, whatever they're
  called), conda envs, `node_modules`, `__pycache__` and tool caches, and build folders *only when
  the project type matches*: `Library` only in Unity projects, `target` only next to
  `Cargo.toml`/`pom.xml`, `dist`/`build` only in buildable projects.
- **Large files** (left out by default): media ≥ 50 MB, archives, model weights ≥ 10 MB.
  Tick any of them to keep it.
- **Git history** (`.git`, left out by default).

Across all units:

- **File types** panel: every file type in the selection, grouped (audio, video, images,
  models, archives…), each set to *keep / skip over 100, 10 or 1 MB / skip all*.
  **Skip big media & models** does the common case in one click. Ticking a single file inside a
  unit keeps it anyway.
- **Secrets** (`.env`, keys, credentials files) are flagged, since they'd land on the drive
  unencrypted. **Leave secrets out** removes them all at once. Templates like `.env.example`
  aren't flagged.
- **Not in git**: anything a project's `.gitignore` excludes (and that isn't rebuildable) is listed,
  because the backup is the only other copy of it. These are kept.

### 3. Back up

Choose a drive (each gets a default `ProjectBackups` folder) or type/browse any folder, then:

- **Copy**: copies with rsync, so running it again later only copies what changed.
  Optional checksum verification afterwards.
- **Move (archive)**: copy, verify by checksum, then delete the local unit and leave a
  `MOVED-TO-BACKUP.txt` note where it was.

On the drive you get:

```
<drive>/ProjectBackups/<root>/
├── <project>/
│   └── .backup-meta/RESTORE.md     # how to rebuild what was left out
└── .storage-profiler/              # JSON manifest of every run
```

`RESTORE.md` has the rebuild commands per project: a `pip freeze` and Python version for every
venv, `npm install` for `node_modules`, the Unity version, symlinks that couldn't be copied, and
any file types that were skipped.

### 4. Free up space (second tab)

Lists every rebuildable folder with the age of its project. Folders in projects untouched for
**6+ months** are ticked to start with; presets switch to *1+ year*, *caches only*, *everything*
or *none*.

**Delete** removes them from this computer. Before that, each project gets
`.rebuild-notes/REBUILD.md` (plus a `<venv>.requirements.txt` per venv) with the commands to
recreate them, and later backups include these notes.

---

## Safety

- **Move** deletes a unit only after rsync finishes cleanly **and** a checksum comparison of the
  source and the backup finds no differences. Otherwise the unit is left untouched.
- **Move** is refused if anything that *can't* be rebuilt is left out (large files, skipped
  file types, secrets or `.git`), since that would lose it for good. Use Copy for those.
- **Free up space** re-checks each folder on disk right before deleting it (it must still be
  a venv / `node_modules` / etc.), and keeps a venv whose package list couldn't be recorded.
- The server refuses to delete anything that isn't a rebuildable folder from the scan, and refuses
  a destination inside the folder being backed up.

**Tip:** do a **Copy** first and look at the result on the drive before using Move or Free up space.

## Drive notes

- **exFAT / FAT / NTFS** can't store symlinks or Unix permissions. Files are copied with
  timestamps only, and symlinks are listed in the restore notes.
- **FAT32** also can't hold files over 4 GB; reformat to exFAT or ext4 if that's a problem.
- If the drive is too small for the selection, the backup panel warns you before you start.

---

## Project layout

```
server/
  index.js      HTTP server, API routes, security checks (Host/Origin)
  scan.js       walks the folder, builds units, sizes, file types, secrets, git-ignored files
  classify.js   rules for what's rebuildable, project types, heavy files, secrets
  backup.js     copy / verify / move jobs with rsync, restore notes, manifest
  cleanup.js    "Free up space" jobs and .rebuild-notes
  notes.js      pip freeze and per-type rebuild instructions (shared by backup and cleanup)
  drives.js     mounted drives and filesystem types
src/
  App.jsx       main page: scan, tabs, units table
  plan.js       works out what's copied for each unit from the current choices
  fileTypes.js  file type categories and rule options
  components/   panels: destination, file types, secrets, cleanup, job progress, folder picker
```

Built with React 19, Vite and Tailwind v4 for the UI and plain Node (no extra server
dependencies) plus rsync for the copying.
