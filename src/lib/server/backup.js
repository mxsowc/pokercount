// Automatic daily backup of the data directory.
//
// Once a day the whole DATA_DIR (accounts, games, follows, reactions, comments,
// and the session secret) is archived to a timestamped .tar.gz under
// DATA_DIR/backups, keeping the last PC_BACKUP_KEEP_DAYS days (default 14). If
// S3-compatible storage is configured (Cloudflare R2, Backblaze B2, AWS S3, …)
// each archive is also uploaded off-site, so a total disk loss can't take the
// backups down with it.
//
// The scheduler is idempotent per calendar day: it checks hourly whether
// today's archive already exists and only makes one if not, so restarts and
// redeploys never double up or miss a day. Every step is wrapped so a backup
// failure logs loudly but can never crash the app.

import { execFile } from 'node:child_process';
import { readdirSync, existsSync, mkdirSync, statSync, unlinkSync, renameSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DATA_DIR } from './paths.js';

const exec = promisify(execFile);

const BACKUP_DIR = join(DATA_DIR, 'backups');
const KEEP_DAYS = Number(process.env.PC_BACKUP_KEEP_DAYS) || 14;
const PREFIX = 'potcount-';

/** Today as YYYY-MM-DD (UTC) — also the archive's chronological sort key. */
function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}
/** @param {string} stamp */
function archiveName(stamp) {
  return `${PREFIX}${stamp}.tar.gz`;
}

/** Build today's archive if it isn't there yet. Returns its path, or null if skipped.
 * @param {string} stamp @returns {Promise<string | null>} */
async function createArchive(stamp) {
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
  const finalPath = join(BACKUP_DIR, archiveName(stamp));
  if (existsSync(finalPath)) return null; // already done today
  const tmpPath = finalPath + '.tmp';
  // Archive DATA_DIR's contents but not the backups folder itself or temp files.
  // Each store writes via temp+rename, so every file on disk is internally
  // consistent — good enough for a point-in-time snapshot at home-game scale.
  await exec('tar', ['-czf', tmpPath, '-C', DATA_DIR, '--exclude=./backups', '--exclude=*.tmp', '.']);
  renameSync(tmpPath, finalPath); // atomic publish: a half-written archive is never seen as "today's"
  return finalPath;
}

/** Delete local archives beyond the newest KEEP_DAYS (names sort chronologically). */
function prune() {
  if (!existsSync(BACKUP_DIR)) return;
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith('.tar.gz'))
    .sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP_DAYS))) {
    try { unlinkSync(join(BACKUP_DIR, f)); } catch { /* best effort */ }
  }
}

/** Upload an archive to S3-compatible storage, if configured. Returns true if uploaded.
 * @param {string} filePath @param {string} name @returns {Promise<boolean>} */
async function uploadOffsite(filePath, name) {
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) return false; // off-site not set up — local only
  // Imported lazily so the app doesn't need the AWS SDK unless off-site is enabled.
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: process.env.S3_REGION || 'auto', // R2 uses "auto"
    endpoint: process.env.S3_ENDPOINT || undefined, // R2/B2 endpoint; omit for AWS S3
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === '1' || undefined,
    credentials: { accessKeyId, secretAccessKey },
  });
  const key = (process.env.S3_PREFIX || 'potcount-backups/') + name;
  await client.send(new PutObjectCommand({
    Bucket: bucket, Key: key, Body: readFileSync(filePath), ContentType: 'application/gzip',
  }));
  return true;
}

let running = false;
/** Make today's backup (if not already made), prune old ones, upload off-site. Never throws. */
export async function runBackup() {
  if (running) return;
  running = true;
  try {
    const stamp = todayStamp();
    const path = await createArchive(stamp);
    if (!path) return; // today's archive already exists
    prune();
    const kb = (statSync(path).size / 1024).toFixed(0);
    let offsite = false;
    try { offsite = await uploadOffsite(path, archiveName(stamp)); }
    catch (e) { console.error('[backup] off-site upload failed:', e instanceof Error ? e.message : e); }
    console.log(`[backup] saved ${archiveName(stamp)} (${kb} KB)${offsite ? ' + uploaded off-site' : ' (local only)'}`);
  } catch (e) {
    console.error('[backup] failed:', e instanceof Error ? e.message : e);
  } finally {
    running = false;
  }
}

/** @type {ReturnType<typeof setInterval> | null} */
let timer = null;
/** Start the daily backup loop. No-op in dev/tests unless forced. */
export function startBackupScheduler() {
  if (process.env.PC_BACKUP_DISABLE === '1') return;
  // Only auto-run in the built production server unless explicitly forced, so
  // `vite dev` and `node --test` don't spew archives into your working tree.
  if (process.env.NODE_ENV !== 'production' && process.env.PC_BACKUP_FORCE !== '1') return;
  if (timer) return;
  setTimeout(() => { runBackup(); }, 10_000); // first run shortly after boot
  timer = setInterval(() => { runBackup(); }, 60 * 60 * 1000); // then hourly; per-day guard makes it idempotent
  if (typeof timer.unref === 'function') timer.unref(); // don't hold the process open just for this
}
