# Deploying potcount on a TransIP VPS

You'll buy a small VPS, point your TransIP domain at it, upload the code, and run
one script. Caddy then gives you HTTPS automatically. ~15 minutes.

The app stores everything as JSON files in `data/` — on a VPS that's just the
local disk, so games and accounts persist across restarts with nothing extra.

---

## 1. Create the VPS

In the TransIP control panel → **VPS** → order a **BladeVPS** (the smallest plan
is plenty). Choose **Ubuntu 22.04 or 24.04 (LTS)**. After it's provisioned, note
its **IPv4** and **IPv6** addresses (shown in the VPS overview).

## 2. Point your domain at the VPS (TransIP DNS)

TransIP control panel → your **domain** → **DNS settings**. Remove any default
`A`/`AAAA`/`CNAME` entries on `@` and `www` (they point at TransIP's parking
page), then add:

| Name | Type | Value | TTL |
| --- | --- | --- | --- |
| `@`   | A    | your VPS IPv4 | 300 |
| `www` | A    | your VPS IPv4 | 300 |
| `@`   | AAAA | your VPS IPv6 | 300 |
| `www` | AAAA | your VPS IPv6 | 300 |

DNS can take a few minutes (up to an hour) to propagate. Check with
`ping your-domain.com` — it should resolve to your VPS IP before step 4.

## 3. Upload the code to the VPS

From your computer, in the project folder:

```bash
# replace USER and the IP with your VPS login (root works on a fresh TransIP VPS)
rsync -av --exclude node_modules --exclude data ./ USER@YOUR_VPS_IP:/opt/potcount/
```

(Or `scp -r` the folder, or `git clone` if you push it to a repo.)

## 4. Run the setup script

SSH in and run it once, passing your domain:

```bash
ssh USER@YOUR_VPS_IP
cd /opt/potcount
sudo bash deploy/setup.sh your-domain.com
```

It installs Node + Caddy, starts the app as a service, and configures HTTPS.
When it finishes, open **https://your-domain.com** — done.

---

## Day-to-day

```bash
systemctl status potcount       # is it running?
journalctl -u potcount -f       # live app logs
systemctl restart potcount      # after uploading new code
journalctl -u caddy -f            # HTTPS / certificate logs
```

**Updating:** re-run the `rsync` from step 3, then `sudo systemctl restart
potcount`.

**Backups:** the only thing to back up is the `data/` folder, e.g.
`rsync -av USER@YOUR_VPS_IP:/opt/potcount/data ./backup/`.

## Optional: enable "Sign in with Google"

1. Google Cloud Console → **Credentials** → **OAuth client ID** → **Web
   application**. Add `https://your-domain.com` as an *Authorized JavaScript
   origin*.
2. On the VPS, edit `/etc/systemd/system/potcount.service`, uncomment the
   `GOOGLE_CLIENT_ID=` line and paste your client id.
3. `sudo systemctl daemon-reload && sudo systemctl restart potcount`.

The button appears automatically and tokens are verified server-side.

## Notes

- The service already sets `COOKIE_SECURE=1` (safe because Caddy serves HTTPS)
  and `PORT=3000` (Caddy proxies to it; only 80/443 are public).
- TransIP's classic **Web Hosting** (shared PHP) can't run Node — this guide is
  for a **VPS**. The domain can live at TransIP regardless.
