# Krushinath Green Energy — Sugar House Register
 
Mobile-first Sugar House shift register built with React, Vite, TypeScript, Express, Prisma, and PostgreSQL. The web application is also the PWA client for Capacitor Android.

## Production readiness

The repository contains the application and a Docker deployment for a dedicated Windows PC, including database isolation, health checks, automatic migrations, Cloudflare Tunnel, and scheduled database backups. Deployment is **not live or operationally accepted** until the hosting PC is configured, the Cloudflare route works, verified factory balances are entered, the owner and employees are initialized, and the team completes the acceptance checks below. Never use sample balances for factory operations.

## Run locally for development

Requirements: Node.js 20+, PostgreSQL 15+, and (for Android project generation) Android Studio with an installed Android SDK.

1. Copy `apps/api/.env.example` to `apps/api/.env`; set a local PostgreSQL URL and two different random JWT secrets.
2. Copy `apps/web/.env.example` to `apps/web/.env`; use `http://localhost:4000/api` for the local API.
3. From the repository root, run `npm install`, `npm run db:generate`, and `npm run db:migrate`.
4. Configure actual initial balances, owner credentials, and `CONFIRM_INITIAL_BALANCES=true` only after checking every grade against the factory charge book. Run `npm --workspace apps/api run seed` once.
5. Start the development app using `npm run dev`.

The initial owner password is hashed. Re-running the seed will not replace the owner password or overwrite an existing season's balances.

## Production: dedicated Windows PC + Docker Desktop + Cloudflare Tunnel

This is the intended no-VPS setup. The PC runs the app and PostgreSQL. Cloudflare Tunnel publishes only the web app over an outbound connection, so no router port forwarding is needed. Use Docker Desktop with Linux containers/WSL 2. Keep the PC powered, awake, online, and Docker Desktop running; if the PC or its internet connection stops, the app becomes unavailable.

### 1. Prepare the host

- Install Docker Desktop with the WSL 2 backend and start it. Confirm `docker info` works in PowerShell.
- In Docker Desktop settings, enable starting Docker Desktop when you sign in.
- Keep the PC plugged in and set Windows sleep to **Never** while plugged in. Do not disable security updates or antivirus.
- Keep the project in a stable local folder. Do not run it from a removable drive or a cloud-synced folder.
- Do not configure router port forwarding. The Compose file binds local web access to `127.0.0.1:8080`; PostgreSQL and the API have no public host ports.

### 2. Prepare the public hostname in Cloudflare

The Cloudflare zone for `krushinathgreenenergy.in` must show **Active**. In Cloudflare Zero Trust, create a remotely managed tunnel and add a published application route:

- Hostname: `sugar.krushinathgreenenergy.in`
- Service: `http://web:80`

Keep the apex hostname and `www` available for the separate Krushinath website. Copy the tunnel token into the local environment file in the next step. Treat it as a password; do not commit it or paste it into chat.

### 3. Create and protect production settings

From PowerShell in the project root:

```powershell
Copy-Item deploy/.env.production.example deploy/.env.production
notepad deploy/.env.production
```

Replace every placeholder locally. Set a long random PostgreSQL password using only letters and numbers, two different random JWT secrets (at least 32 characters), the Cloudflare tunnel token, and the initial owner credentials. Verify the season name/start date, all four grade-wise opening stock values, and all four cumulative values against the physical register. Keep `CONFIRM_INITIAL_BALANCES=false` until each number is checked. Never share the real `.env.production` file or commit it.

### 4. Start the production services

```powershell
docker compose --env-file deploy/.env.production config --quiet
docker compose --env-file deploy/.env.production --profile tunnel up -d --build db api web db-backup cloudflared
```

The API applies checked-in Prisma migrations before serving. PostgreSQL is reachable only on the private database network. Nginx serves the web app, proxies `/api` to the API, and forwards Cloudflare's client IP so authentication rate limits work per visitor. `/api` responses are marked non-cacheable.

Check the services and the local health endpoint:

```powershell
docker compose --env-file deploy/.env.production ps
Invoke-WebRequest http://127.0.0.1:8080/api/health
docker compose --env-file deploy/.env.production logs --tail 50 db api web db-backup cloudflared
```

The health endpoint must report `status: ok` and `database: ok`. Confirm `https://sugar.krushinathgreenenergy.in` opens from a device outside the factory Wi-Fi before onboarding workers.

### 5. Initialize factory data once

After the opening and cumulative balances have been checked against the paper book, set `CONFIRM_INITIAL_BALANCES=true` in the local environment file. Then run:

```powershell
docker compose --env-file deploy/.env.production --profile tunnel --profile bootstrap run --rm seed
```

This creates the owner, four grades, default shifts, factory settings, the season, and opening ledger entries. The seed service explicitly runs the seed command; it does not start a second API server. Keep the owner credentials private. The owner should sign in, create named accounts for employees, assign shift chemists, and verify role access before daily entry begins.

### 6. Protect and check backups

The `db-backup` service creates a validated PostgreSQL custom-format archive immediately and every 6 hours, then keeps 14 days of local archives under `backups/`. After initial seeding, request an immediate archive as well:

```powershell
docker compose --env-file deploy/.env.production exec -T db-backup /usr/local/bin/backup.sh once
```

Check its status and recent log:

```powershell
Get-ChildItem backups
docker compose --env-file deploy/.env.production logs --tail 50 db-backup
```

These local backups are **not sufficient by themselves**: a failed or stolen PC can destroy both the database and its backups. Regularly copy the archives to a separate encrypted drive or protected off-PC storage. Restrict access to that storage and periodically perform a restore drill on a separate test database. Do not use `docker compose down -v`; `-v` deletes the production database volume.

Before a restore, stop `api` and `web`, preserve a copy of the current database, and use a selected archive from `/backups` with `pg_restore --clean --if-exists --no-owner` through the `db-backup` container. A restore overwrites database objects; confirm the target before running it.

### 7. Host restart and recovery

After a Windows restart, start/sign in to the Windows account, wait for Docker Desktop to become ready, then check `docker compose ... ps`. Services use `restart: unless-stopped` and should return automatically. Test this before workers depend on the system. Check Windows power and network settings after updates or power interruptions. Use the Cloudflare hostname and Cloudflare dashboard to confirm the tunnel is healthy. Keep an off-PC backup even if automatic container restarts work.

To view logs:

```powershell
docker compose --env-file deploy/.env.production logs --tail 100 api web db db-backup cloudflared
```

For an application update, make and verify an off-PC database backup first, then apply the reviewed code and run:

```powershell
docker compose --env-file deploy/.env.production --profile tunnel up -d --build db api web db-backup cloudflared
```

Do not delete the database volume during routine updates. Review migration output and verify the health endpoint after each update.

## Go-live acceptance checklist

Do not enter live factory records until all of these are verified:

- Cloudflare zone is Active and the fixed HTTPS hostname works from a mobile device on cellular data.
- `/api/health` reports a healthy database; the login page and all app navigation load over HTTPS.
- Owner, manager, chemist, and viewer accounts have the intended permissions; test with non-production records/accounts first.
- Check the shift date boundary, overnight shift assignment, carried-forward stock, grade totals, dispatch, approval and locking, audit history, correction requests, reports, and exports against the paper book.
- Test offline draft creation and later sync on a device; confirm conflicts remain reviewable and no draft is silently lost.
- Confirm the automatic backup was created, copy it off the host, and complete a restore drill in a separate test environment.
- Restart the host and verify Docker services and the Cloudflare tunnel recover without changing the public URL.
- Have the Sugar House manager/clerk and chemist accept the workflow and opening balances.

## Checks

- `npm test` runs the API calculations/security/report tests and web offline synchronization tests.
- `npm run build` compiles the API and produces a Vite production build. `VITE_API_BASE_URL=/api` is the single-hostname production setting.
- `npm run db:generate` regenerates the Prisma client.
- The end-to-end API workflow requires a disposable database whose name includes `test` or `e2e`. Never use the production database for automated tests.

## Android (deferred until the hosted API is verified)

No APK is built as part of this production preparation. Once the web app and API work through the permanent HTTPS hostname, set the API URL to `https://sugar.krushinathgreenenergy.in/api`, run `npm --workspace apps/web run android:sync`, and build only when explicitly requested. The API URL is embedded into the Android assets; changing it requires another sync/build. Before distributing a release APK, configure a private signing key and build the signed release variant. Never commit signing keys or passwords.

## Data integrity and application scope

Approved records are immutable through normal record editing. Stock movements are ledger entries created within approval transactions. Corrections require an owner decision and audit trail, and affected later balances are recalculated. Offline drafts remain in the device's IndexedDB until the server confirms synchronization; conflicts require review. Reports export as CSV or multi-sheet Excel workbooks. Verify every operational label and all initial factory balances with the physical Sugar House Charge Book before production use.
