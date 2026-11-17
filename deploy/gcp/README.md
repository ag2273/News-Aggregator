# Self-hosting on a Google Cloud e2-micro VM (free tier)

Run the News Aggregator server on a permanently free Google Cloud
`e2-micro` VM with automatic HTTPS from Caddy.

What you get:

- `server` — the Hono API on port 3001, reachable only inside Docker,
  data persisted in the named volume `server-data` mounted at `/data`.
- `caddy` — public reverse proxy on ports 80/443, obtains and renews a
  Let's Encrypt certificate for your domain automatically.

Files:

| File                   | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `docker-compose.yml`   | both services, volumes, restart policy               |
| `deploy/Caddyfile`     | TLS + reverse proxy to `server:3001` (`{$DOMAIN}`)   |
| `deploy/.env.example`  | template for `deploy/.env` (`DOMAIN=...`)            |
| `deploy/gcp/setup.sh`  | installs Docker, opens ports, writes `.env`, starts  |

## 1. Create the VM

1. In the Google Cloud console open **Compute Engine → Create instance**.
2. **Machine type**: `e2-micro` (this is the free-tier eligible type;
   pick the `us-west1`, `us-central1`, or `us-east1` region — free tier
   is region-limited).
3. **Boot disk**: Debian 12 or Ubuntu 24.04, 30 GB standard persistent disk.
4. **Networking**: allow **HTTP** and **HTTPS** traffic (creates ingress
   rules for `tcp:80` and `tcp:443`). If the checkboxes are missing, add
   a firewall rule for `tcp:80,tcp:443` from `0.0.0.0/0` afterwards.
5. Create, then note the **external IP** of the VM.

> e2-micro has 1 GB of RAM. The Docker build is the heaviest step; if it
> gets OOM-killed, stop the stack, add swap, and re-run. See the note at
> the bottom.

## 2. SSH in and run the setup script

```bash
gcloud compute ssh <instance-name>        # or ssh from the console

sudo apt-get update -y && sudo apt-get install -y git
git clone <your-repo-url> news-aggregator
cd news-aggregator
chmod +x deploy/gcp/setup.sh
./deploy/gcp/setup.sh news.example.com    # use your real domain
```

The script is idempotent — re-running it replaces the domain and restarts
the stack. It will:

1. install Docker (`docker.io` + compose plugin, falling back to Docker CE);
2. enable and start `docker`;
3. `ufw allow 80/tcp` and `443/tcp` when `ufw` is installed;
4. write `deploy/.env` with `DOMAIN=<your domain>`;
5. validate the compose file, then `docker compose up -d --build`.

## 3. Point the domain at the VM

Create an **A record** for your domain pointing at the VM's external IP.

```
news.example.com  A  34.123.45.67
```

Caddy must be able to resolve the domain **before** it can issue the
certificate. If you start the stack first, Caddy just keeps retrying
every few seconds and succeeds once DNS propagates — no action needed.
Certificate files live in the `caddy-data` volume, so they survive
redeploys and container restarts.

## 4. Verify

```bash
curl https://news.example.com/health     # {"ok":true}
curl https://news.example.com/api/feed   # real articles
```

On the VM:

```bash
sudo docker compose ps
sudo docker compose logs -f caddy
```

## Free domain without buying one: DuckDNS

Let's Encrypt needs a real, publicly resolvable hostname — a bare IP
address will not get a valid certificate. [DuckDNS](https://www.duckdns.org)
gives you a free subdomain such as `mynews.duckdns.org`.

1. Sign in at duckdns.org with GitHub/Google/Twitter.
2. Create a subdomain, e.g. `mynews` → `mynews.duckdns.org`.
3. Set its **current ip** to the VM's external IP (or use the `ip=`
   update URL from your dashboard, which contains your account token —
   keep that token private and never commit it).
4. Run the setup script with that hostname:

   ```bash
   ./deploy/gcp/setup.sh mynews.duckdns.org
   ```

5. Verify: `curl https://mynews.duckdns.org/health`.

DuckDNS may take a minute to propagate. There is no HTTP API to query
your token for you; copy it from the DuckDNS dashboard.

## Day-2 operations

```bash
sudo docker compose ps                 # status
sudo docker compose logs -f server     # API logs
sudo docker compose up -d --build      # rebuild after a git pull
sudo docker compose down               # stop (volumes are kept)
```

The data volumes are named `server-data`, `caddy-data`, and
`caddy-config`. They are not removed by `down`; use `down -v` only if you
want to erase all articles, users, saves and certificates.

## Caveats

- **Build memory**: the multi-stage build runs `pnpm install` and `tsc` on
  the VM. On 1 GB of RAM, add swap first if it fails:

  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```

- **DNS first**: Caddy cannot issue a certificate for an IP or for a
  domain that does not resolve to this VM. It retries, so a wrong/slow
  DNS record only delays HTTPS.
- **Port 3001 is not published** on the host; all traffic goes through
  Caddy, which is the only thing exposed to the internet.
- The app keeps refreshing feeds on a 10-minute timer inside the
  container; nothing else needs cron.
