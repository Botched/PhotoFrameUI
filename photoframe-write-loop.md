# Fix: photoframeui rewrites photos.json ~35×/s (save → broadcast → resync loop)

## Problem

In production (container `photoframeui-photoframe-1`, image `ghcr.io/botched/photoframeui:latest`), `python app.py` writes about **9 MB/s, roughly 0.8 TB/day**, to `data/photos.json` whenever a frame client is connected. The file is 267 KB and is rewritten about 35 times per second. This is wearing out the host's SSD.

Measured 2026-11-19: 86 GB written in the 2.6 h since container start. `/proc/<pid>/io` `write_bytes` rose by 184 MB in 20 s. Logs are small (1.6 MB), so this is not logging.

## Root cause: a feedback loop

Line numbers refer to `main` at `b277341`.

1. `sync_photos()` (`app.py` 181–214) walks the upload folder, then **always** calls `save_photos_meta(meta)` (line 213), even when nothing changed.
2. `save_photos_meta()` (`app.py` 89–92) writes the file and calls `broadcast_update('photos_changed')`, which emits to **every** client on `/frame`.
3. `static/js/frame.js` 50–52 answers `photos_changed` with `socket.emit('request_sync')`.
4. `handle_sync_request()` (`app.py` 737–743) calls `sync_photos()`, which goes back to step 1 and repeats forever. With more than one frame connected, each sync triggers a request from every frame, so the loop amplifies.

`GET /api/photos` (`app.py` 224–229) also calls `sync_photos()`, so every read of the photo list causes a write and a broadcast.

## Required changes

1. **`sync_photos()` saves only when the metadata changed.** That means at least one key was removed (file missing on disk) or added (new file). When nothing changed, it returns `meta` without writing or broadcasting. `delete_folder()` relies on `sync_photos()` to drop the deleted keys; that still works because keys are removed.
2. **Reads must not write.** After the change, `GET /api/photos` and the `request_sync` handler must cause no disk write and no `photos_changed` broadcast while the upload folder is unchanged. (The one-time `save_settings(DEFAULT_SETTINGS)` in `load_settings()` when `settings.json` does not exist is acceptable.)
3. **Atomic metadata writes (related correctness bug).** `save_photos_meta()` writes in place, while `load_photos_meta()` returns `{}` on any parse error (bare `except`). A read that overlaps a write can therefore see a partial file, get `{}`, and re-add every photo as `active: True` with a new `added` time. That silently undoes the user's active/inactive toggles and reorders photos. Fix:
   - Write JSON (keep `indent=4`) to a temp file in the **same directory** as the target (e.g. `tempfile.NamedTemporaryFile(dir=..., delete=False)` or `mkstemp`), `flush()` and `os.fsync()` it, then `os.replace()` it over the target.
   - If writing fails, remove the temp file and re-raise; do not broadcast.
   - Use one shared helper for both `photos.json` and `settings.json`. Broadcasting stays in `save_photos_meta()` / `save_settings()`, after a successful replace.
4. **Keep existing behaviour for real changes.** Upload, photo delete, folder delete, batch move, single-photo toggle, folder toggle, rotate, Google import, and settings save still save and broadcast exactly as they do today (Google import still broadcasts once per imported photo), and connected frames still update.

## Non-goals

- No change to `frame.js` or the client protocol. Answering `photos_changed` with `request_sync` is fine once the server stops broadcasting on no-op syncs.
- No new runtime or test dependencies, no database migration, no UI changes.
- Not in scope: making `load_photos_meta()` fail loudly on a genuinely corrupt file, locking against concurrent read-modify-write between handlers, and batching Google-import broadcasts. Mention them as residual risks in the report.
- Optional, not required: throttle the `os.walk` scan of all 1,610 uploads per sync, for example by caching the result for a few seconds.

## Tests (write them first)

The repo has no tests yet. Use stdlib `unittest` in `tests/test_sync.py`, run with `python -m unittest discover -s tests -v` from the repo root. Use Flask's `app.test_client()` and Flask-SocketIO's `socketio.test_client(app, namespace='/frame')`; both ship with the installed packages.

**Isolation:** `app.py` builds `SETTINGS_FILE`, `PHOTOS_META_FILE` and `app.config['UPLOAD_FOLDER']` / `THUMBNAIL_FOLDER` at import time relative to the CWD. Each test must point all of them at a fresh `tempfile.TemporaryDirectory()` (patch the module attributes and `app.config`) and must never read or write the real `data/` or `static/` folders.

**Counting writes and broadcasts:** count calls with `unittest.mock` on the write helper and on `broadcast_update` (or read `photos_changed` events from the SocketIO test client's `get_received('/frame')`). Do not rely on file mtime alone; its resolution is too coarse on some filesystems.

- `sync_photos()` with an unchanged upload folder: zero writes and zero `photos_changed` broadcasts; file contents unchanged.
- `sync_photos()` after adding a file: exactly one write and one broadcast. After removing a file: the same.
- Calling `request_sync` or `GET /api/photos` repeatedly (e.g. 10×) with no folder changes: zero writes and zero broadcasts; `request_sync` still returns `full_sync` with the photos.
- Simulated loop: a SocketIO test client that emits `request_sync` whenever it has received `photos_changed`, run for at most 20 rounds, reaches a fixed point: at most one `photos_changed` per real change, and no further events after that.
- Atomic save: after `save_photos_meta()` and `save_settings()`, each file parses as valid JSON with the saved content, and no temp file is left in the directory. If the write fails (e.g. mock `json.dump` to raise), the original file is unchanged, no temp file remains, and nothing is broadcast.
- `POST /api/photo/toggle/<file>` and `POST /api/folder/toggle` still write once and broadcast once.

## Acceptance (production check, done by the infra side)

With a frame client connected and idle for 60 s, after deploying:
- `photos.json` mtime does not change.
- The container's `write_bytes` grows by **< 5 MB/min**. It was ~550 MB/min before.
- Uploading or toggling a photo still updates the connected frame.

## Report back

The changed files, the test command and its full output, and anything left unverified (including the residual risks above). The implementer does not commit, push, or build/push images. After owner-approved merge to `main`, `.github/workflows/docker-push.yml` builds and pushes `latest` plus `sha-<short commit>`; the Lead reports that tag/digest for deployment.
