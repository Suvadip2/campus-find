# Campus Find — College Lost & Found

A small end-to-end DevOps demo: students can post lost/found listings with optional photos, search the campus board, contact a poster, and confirm successful returns. The React/Vite UI talks to a Node.js/Express API. Docker Compose runs the site, API, persistent listing store, and Prometheus monitoring.

The `/login` route supports student registration and sign-in, plus a separate administrator sign-in. Visitors must authenticate before the dashboard and listings are served; opening the site root while signed out redirects to `/login`. Passwords are stored as scrypt hashes and sessions use HttpOnly, SameSite cookies. Students may post listings, view their own listing history, and resolve their own unmatched listings. Administrators use the separate `/admin` dashboard to review listing statistics, possible matches, reports, and moderation history; they cannot post as or resolve items on behalf of students.

Reports and moderation audit events are stored in `moderation.json` in the persistent API data directory/volume. Admin removals are soft removals: the listing remains in `items.json` with status `removed`, while the moderation reason, actor, timestamp, and related report actions remain auditable.

### Possible matches and confirmed returns

Listing lifecycle statuses are stored consistently as `open`, `resolved`, or `removed`. Match suggestions and confirmation counts are separate metadata; `matched` and `pending_confirmation` are not listing statuses. Legacy uppercase status values are normalized on read, so `REMOVED` cannot be mistaken for an active post.

New listings are compared with open listings of the opposite type. Category and item-name similarity are required; optional brand/color and available description/location details provide corroboration. A possible match is only a suggestion: neither post is resolved automatically. Only the two distinct listing owners can confirm a successful return, and each owner can confirm once. Once both have confirmed, both records are changed together in a single atomic JSON-file replacement to `resolved`; neither can be left in a partially resolved state. Resolved records remain in storage and appear in the admin dashboard’s separate **Resolved / History** section, not in its active listings section. Removed records likewise stay retained in a separate moderation history. Public active listings, filters, search, and metrics use only `open` records. The board polls for listing and match updates every five seconds.

Posters can include optional brand and color fields to improve match suggestions. A listing already in a pending possible match cannot be independently resolved; both owners must confirm through the match notification.

## Run locally with Docker

Requirements: Docker Desktop with Docker Compose.

First configure the administrator account in a local `.env` file (copy `.env.example` and set both values; passwords must be 6–128 characters):

```dotenv
ADMIN_EMAIL=admin@your-college.edu
ADMIN_PASSWORD=use-a-unique-password-of-at-least-12-characters
```

The admin is provisioned the first time the API starts. Student accounts can be registered on `/login` with a password of at least 6 characters. Keep `.env` private; it is ignored by Git. A 6-character minimum is suitable only for this local demonstration; use stronger passwords for real deployments.

```powershell
docker compose up --build -d
```

Open:

- Site: <http://localhost:8080>
- API health: <http://localhost:8080/api/health>
- Prometheus: <http://localhost:9090>

Try creating a listing, then check Prometheus at `http://localhost:9090/targets` and query `campus_find_items` or `campus_find_http_requests_total`. Data is saved in the `campus-find-data` Docker volume and survives container restarts.

Stop the local demo with `docker compose down`. To also delete saved listings, accounts, and sessions, run `docker compose down -v`.

## Run without Docker

Requirements: Node.js 22 or newer and npm.

```powershell
npm install
npm run dev
```

Vite prints the frontend URL (normally <http://localhost:5173>) and proxies `/api` requests to the Node API at port 3000. API records are stored in `server/data/items.json`.

For an initial admin with the direct Node development command, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the shell before `npm run dev`.

## CI/CD flow

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`:

1. Installs the npm workspaces from the lockfile.
2. Runs Node API integration tests.
3. Builds the Vite frontend and validates Compose configuration.
4. On pushes to `main`, builds and publishes API and web images to GitHub Container Registry (GHCR), tagged `latest` and with the commit SHA.
5. Optionally deploys those images to a Docker host over SSH.

To enable automatic deployment, configure these repository variables:

- `DEPLOY_HOST`: reachable Docker host name or IP.
- `DEPLOY_USER`: SSH user.
- `DEPLOY_PATH`: directory on the host containing `docker-compose.deploy.yml` and `monitoring/prometheus.yml`.

Add the private key as the `DEPLOY_SSH_KEY` repository secret. The host must have Docker Compose, be able to pull the published GHCR images, and contain the deployment Compose file and monitoring config. If the GHCR packages are private, configure Docker login on that host. Without `DEPLOY_HOST`, the publish job still runs and local Compose deployment remains available.

For the first hosted start, create a private `.env` in `DEPLOY_PATH` with `ADMIN_EMAIL` and `ADMIN_PASSWORD` before deploying; do not put the admin password in a tracked file.

For a local deployment using images already published to GHCR:

```powershell
$env:IMAGE_OWNER = "your-github-owner"
docker compose -f docker-compose.deploy.yml up -d
```

## Monitoring and operations

- `/api/health` is the API readiness endpoint and is also used by Docker's health check.
- `/api/metrics` exposes Prometheus counters/gauges for total API requests and listing count.
- Prometheus scrapes the API every 15 seconds; use its Targets page to verify scrape health.
- Compose restarts the API and web containers unless explicitly stopped.
- Listing data is stored in a named volume rather than the disposable API container filesystem.
- Item photos accept JPG, PNG, GIF, or WebP, are resized/compressed in the browser, and are capped at 1 MB per image.

Account data and hashed passwords are stored in `auth.json` in the API data directory/volume. The initial admin credentials are only used when that email has not already been provisioned; deleting `auth.json` resets local accounts and sessions. Use HTTPS in a public deployment so the API sends Secure session cookies, and do not expose the app publicly without additional production hardening and campus-specific account policies.
