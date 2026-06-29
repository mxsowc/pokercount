// Durable atomic file write: write to a temp file, fsync its contents, rename
// into place, then fsync the containing directory. The temp+rename alone makes a
// reader never see a half-written file, but does NOT guarantee the data survived
// a crash/power-loss — without fsync the rename can outrun the bytes and the
// latest write is lost. Used by every file-backed store. Home-game write rates
// make the extra fsync cost negligible.

import { openSync, writeSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

/** @param {string} path @param {string} data */
export function writeFileDurable(path, data) {
  const tmp = path + '.tmp';
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, data);
    fsyncSync(fd); // flush file contents before we publish the rename
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  // fsync the directory so the rename entry itself is durable (best effort —
  // not all platforms allow opening a dir for fsync).
  let dfd;
  try { dfd = openSync(dirname(path), 'r'); fsyncSync(dfd); }
  catch { /* best effort */ }
  finally { if (dfd !== undefined) try { closeSync(dfd); } catch { /* ignore */ } }
}
