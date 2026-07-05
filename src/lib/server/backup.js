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
import { writeFileDurable } from './fsutil.js';
import { sendEmail, emailConfigured } from './email.js';

const exec = promisify(execFile);

const BACKUP_DIR = join(DATA_DIR, 'backups');
const KEEP_DAYS = Number(process.env.PC_BACKUP_KEEP_DAYS) || 14;
const PREFIX = 'potcount-';
// Heartbeat of the last verified off-site backup, so a silent failure (disk fine,
// upload broken) becomes a same-day alert instead of a nasty surprise at restore.
const HEARTBEAT_FILE = join(DATA_DIR, 'last-backup.json');
const STALE_MS = 48 * 60 * 60 * 1000;       // alert if no good backup in 48h
const ALERT_EVERY_MS = 24 * 60 * 60 * 1000; // …but re-alert at most once a day

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

/** True when S3-compatible off-site storage is configured. */
function offsiteConfigured() {
  return !!(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
}

/** Build an S3 client + bucket/key for a backup name, or null if off-site isn't set up.
 * @param {string} name @returns {Promise<{ client: any, bucket: string, key: string } | null>} */
async function s3Ctx(name) {
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  // Imported lazily so the app doesn't need the AWS SDK unless off-site is enabled.
  const { S3Client } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: process.env.S3_REGION || 'auto', // R2 uses "auto"
    endpoint: process.env.S3_ENDPOINT || undefined, // R2/B2 endpoint; omit for AWS S3
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === '1' || undefined,
    credentials: { accessKeyId, secretAccessKey },
  });
  return { client, bucket, key: (process.env.S3_PREFIX || 'potcount-backups/') + name };
}

/** Upload an archive off-site, if configured. Returns true if uploaded.
 * @param {string} filePath @param {string} name @returns {Promise<boolean>} */
async function uploadOffsite(filePath, name) {
  const ctx = await s3Ctx(name);
  if (!ctx) return false; // off-site not set up — local only
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  await ctx.client.send(new PutObjectCommand({
    Bucket: ctx.bucket, Key: ctx.key, Body: readFileSync(filePath), ContentType: 'application/gzip',
  }));
  return true;
}

/** Confirm the uploaded object really exists off-site at the expected byte size —
 *  an upload that returns 200 but stored 0 bytes would otherwise pass silently.
 * @param {string} name @param {number} expectedSize @returns {Promise<boolean>} */
async function verifyOffsite(name, expectedSize) {
  const ctx = await s3Ctx(name);
  if (!ctx) return false;
  const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
  const head = await ctx.client.send(new HeadObjectCommand({ Bucket: ctx.bucket, Key: ctx.key }));
  return head.ContentLength === expectedSize;
}

function readHeartbeat() {
  try { if (existsSync(HEARTBEAT_FILE)) return JSON.parse(readFileSync(HEARTBEAT_FILE, 'utf8')); }
  catch { /* treat as none */ }
  return null;
}
/** @param {Record<string, any>} data */
function writeHeartbeat(data) {
  try { writeFileDurable(HEARTBEAT_FILE, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('[backup] heartbeat write failed:', e instanceof Error ? e.message : e); }
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
    const sizeBytes = statSync(path).size;
    const kb = (sizeBytes / 1024).toFixed(0);
    let offsite = false, verified = false;
    try {
      offsite = await uploadOffsite(path, archiveName(stamp));
      if (offsite) verified = await verifyOffsite(archiveName(stamp), sizeBytes);
    } catch (e) { console.error('[backup] off-site upload/verify failed:', e instanceof Error ? e.message : e); }
    // "good" = a local archive plus, when off-site is configured, a VERIFIED off-site copy.
    const good = offsiteConfigured() ? verified : true;
    writeHeartbeat({ ...(readHeartbeat() || {}), stamp, at: new Date().toISOString(), sizeBytes, offsite, verified, good });
    console.log(`[backup] saved ${archiveName(stamp)} (${kb} KB)${offsite ? (verified ? ' + verified off-site' : ' + uploaded (UNVERIFIED)') : ' (local only)'}`);
  } catch (e) {
    console.error('[backup] failed:', e instanceof Error ? e.message : e);
  } finally {
    running = false;
  }
}

/** Alert the operator (email) if there's been no verified backup in 48h — turns a
 *  silent backup failure into a same-day heads-up. Throttled to once a day. Never throws. */
export async function checkBackupHealth() {
  try {
    const hb = readHeartbeat();
    const now = Date.now();
    const lastGoodAt = hb?.good && hb?.at ? Date.parse(hb.at) : 0;
    if (lastGoodAt && now - lastGoodAt <= STALE_MS) return; // healthy
    const lastAlert = hb?.lastAlertAt ? Date.parse(hb.lastAlertAt) : 0;
    if (lastAlert && now - lastAlert < ALERT_EVERY_MS) return; // already alerted recently
    const ageH = lastGoodAt ? Math.round((now - lastGoodAt) / 3_600_000) : null;
    const detail = ageH != null ? `last verified backup was ${ageH}h ago` : 'no verified backup recorded yet';
    const to = process.env.PC_ALERT_EMAIL;
    if (!to || !emailConfigured()) {
      console.error(`[backup] HEALTH: ${detail} — set PC_ALERT_EMAIL (and email) to be notified`);
      return;
    }
    const msg = `potcount hasn't recorded a verified off-site backup in over 48 hours (${detail}). Check the backup job and S3 credentials/bucket.`;
    await sendEmail({
      to,
      subject: 'potcount backup alert — no verified backup in 48h',
      text: msg,
      html: `<p>${msg}</p>`,
    });
    writeHeartbeat({ ...(hb || {}), lastAlertAt: new Date().toISOString() });
    console.error(`[backup] HEALTH: ${detail} — alert email sent to ${to}`);
  } catch (e) {
    console.error('[backup] health check failed:', e instanceof Error ? e.message : e);
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
  const tick = () => { runBackup().then(() => checkBackupHealth()); };
  setTimeout(tick, 10_000); // first run shortly after boot
  timer = setInterval(tick, 60 * 60 * 1000); // then hourly; per-day guard makes it idempotent
  if (typeof timer.unref === 'function') timer.unref(); // don't hold the process open just for this
}
