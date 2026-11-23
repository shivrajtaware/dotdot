# Krushinath Green Energy · Sugar House Register
   
Mobile-first Sugar House shift register built on React + Vite + TypeScript, Express + TypeScript, Prisma and PostgreSQL. The React application is also the web/PWA client for Capacitor Android. The supplied logo and physical charge-book reference are used in the interface and print view.

## Local setup
 
Requirements: Node.js 20+, PostgreSQL 15+, and (for Android Studio project generation) Android Studio with an installed Android SDK.
 
1. Copy `apps/api/.env.example` to `apps/api/.env`. Set `DATABASE_URL`, owner email/password, season start, and actual opening stock and cumulative balances. Do not use the sample zero balances unless those are the factory's real opening figures; set `CONFIRM_INITIAL_BALANCES=true` only after checking every grade's opening figures against the charge book.
2. Generate two different authentication secrets with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"` (run it twice) and put one in each JWT secret field. The API refuses missing, repeated, short, or template secrets at startup.
3. Copy `apps/web/.env.example` to `apps/web/.env`. Set `VITE_API_BASE_URL` to the API base URL. For local development use `http://localhost:4000/api`.
4. Install dependencies from the repository root: `npm install`.
5. Generate Prisma client and apply the checked-in database migrations: `npm run db:generate`, then `npm run db:migrate`. Use `npm run db:dev` only when intentionally developing a new schema migration against a development database.
6. Create the initial owner, grades, shift definitions, season, and settings: `npm --workspace apps/api run seed`. Seeding refuses missing credentials and the sample `owner@example.com` or password placeholder.
7. Start the API and web app with `npm run dev`.

The owner account is created only on the first seed and only with non-template `OWNER_EMAIL` and `OWNER_PASSWORD` values. Re-running the seed preserves existing owner credentials, configured shifts, deactivated grades, settings, and season opening figures. Passwords are hashed with bcrypt. Change/rotate bootstrap credentials and use HTTPS before remote use.

## Production deployment

### Docker Compose on a Linux server

The repository includes a Compose deployment with a private PostgreSQL container, API and static web containers, database readiness checks, and automatic migration deployment before API startup. The database has no published host port. API and web ports bind to `127.0.0.1` so a host TLS reverse proxy can serve the purchased domains.

1. Install Docker Engine with the Docker Compose plugin on the server and point the web and API DNS records to that server.
2. Copy `deploy/.env.production.example` to `deploy/.env.production`. Replace all sample values. Set the real HTTPS web/API domains, generate distinct JWT secrets, use an alphanumeric database password, and enter verified opening and cumulative balances. Leave `CONFIRM_INITIAL_BALANCES=false` until every grade balance has been checked against the factory book.
3. Validate the Compose configuration and start the services: `docker compose --env-file deploy/.env.production config --quiet`, then `docker compose --env-file deploy/.env.production up -d --build db api web`.
4. After verifying the opening values, change `CONFIRM_INITIAL_BALANCES=true`, replace `OWNER_EMAIL` with the actual owner email and set a unique owner password. Run the one-time initializer: `docker compose --env-file deploy/.env.production --profile bootstrap run --rm seed`. The initializer refuses template owner credentials and unconfirmed balances. It does not run automatically on container startup.
5. Configure the host TLS proxy to forward the web domain to `http://127.0.0.1:8080` and the API domain to `http://127.0.0.1:4000`. Redirect HTTP to HTTPS and retain the `/api` path when proxying API requests. Restrict the server firewall to SSH and HTTPS; PostgreSQL remains on the private Compose network.
6. Check API readiness at `https://<api-domain>/api/health`; it reports healthy only when PostgreSQL responds. Back up the `postgres_data` database using `pg_dump` and store backups outside this server.

For updates, pull or copy the reviewed application source, then run `docker compose --env-file deploy/.env.production up -d --build api web`. API startup applies pending migrations before serving requests. Back up the database before schema upgrades. The Vite API URL is embedded when the web image is built, so rebuild the web image after changing `VITE_API_BASE_URL`.

### Run remotely from a Windows laptop without a VPS

The Compose file includes an optional Cloudflare Tunnel profile. The tunnel makes an outbound connection from the laptop, so the router does not need inbound port forwarding. The laptop must remain powered on, awake, connected to the internet, and running Docker Desktop for the application to be reachable.

1. Create a Cloudflare account and add `krushinathgreenenergy.in`. Review the DNS records Cloudflare detects. If the domain has email or website records, confirm they are present in Cloudflare before changing nameservers. At GoDaddy, replace the domain nameservers with the two Cloudflare assigns; this makes Cloudflare the DNS provider.
2. In Cloudflare, create a remotely-managed tunnel. Add two published application routes to that tunnel: `sugar.krushinathgreenenergy.in` ? `http://web:80`, and `sugar-api.krushinathgreenenergy.in` ? `http://api:4000`. Keep the apex domain and `www` hostname for the Krushinath main website; it can use another route on the same tunnel once its service is reachable by the connector.
3. Copy `deploy/.env.production.example` to `deploy/.env.production`. Keep the real URLs already shown there, replace every secret placeholder locally, and enter the factory-verified opening and cumulative balances. Keep `CONFIRM_INITIAL_BALANCES=false` until those balances are verified.
4. Put the tunnel token in `CLOUDFLARE_TUNNEL_TOKEN` in that local environment file. Treat it like a password: do not commit it or paste it into chat.
5. Start Docker Desktop, then run `docker compose --env-file deploy/.env.production --profile tunnel up -d --build db api web cloudflared` from the project root. The Sugar House app is then available at `https://sugar.krushinathgreenenergy.in` and its API at `https://sugar-api.krushinathgreenenergy.in/api` after Cloudflare activates the DNS and tunnel routes.
6. After checking the opening values, set `CONFIRM_INITIAL_BALANCES=true` and run `docker compose --env-file deploy/.env.production --profile tunnel --profile bootstrap run --rm seed` once to create the owner, grades, shifts, and season.

If `docker info` reports that the Docker named pipe is inaccessible, restart Docker Desktop normally and rerun the command from a PowerShell session that has Docker access. Do not expose the PostgreSQL port on the router. To stop the services, run `docker compose --env-file deploy/.env.production --profile tunnel down`; the `postgres_data` volume remains in place.

### Managed or separate hosts

- Host the Vite `apps/web/dist` files at the purchased web domain using a static web host or Nginx. Configure an SPA fallback to `index.html`.
- Host the Node API on a separate API subdomain, set `API_PORT`, `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `WEB_ORIGIN`, and `MOBILE_ORIGIN=https://localhost` in the API service environment, and run the built service with `npm --workspace apps/api run start`.
- Point DNS A/AAAA or CNAME records for both domains to the chosen hosting provider. Provision TLS certificates for both hostnames and redirect HTTP to HTTPS. A domain purchase by itself does not include application hosting or a database.
- Set `apps/web/.env` `VITE_API_BASE_URL` to the HTTPS API URL before `npm run build`; Vite embeds it in the web bundle.
- Apply database migrations in deployment before starting the API: `npm --workspace apps/api run db:migrate`.
- Restrict PostgreSQL network access to the API host, require TLS where supported, rotate secrets, and store environment files/secrets outside source control.

## Database backup and restore

Run backups on the server with `pg_dump --format=custom --no-owner --file=krushinath-YYYYMMDD.dump "$DATABASE_URL"`. Store encrypted copies in a separate protected location and verify them periodically. Restore to an empty database with `pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" krushinath-YYYYMMDD.dump`. Take a fresh backup before restoring. Keep database credentials out of shell history and logs.

## Checks

- API compile and calculation/export tests: `npm --workspace apps/api test`.
- Offline draft synchronization and conflict tests: `npm --workspace apps/web test`.
- Run both test suites: `npm test`.
- Run the authenticated API workflow: create and migrate a disposable PostgreSQL database whose name includes `test` or `e2e`, seed it, start the API with that database, then set `E2E_API_BASE_URL`, `E2E_DATABASE_URL`, `E2E_OWNER_EMAIL`, and `E2E_OWNER_PASSWORD` and run `npm run test:e2e`. The workflow creates test users and locked records, so never point it at a live database.
- Full API + web production build: `npm run build`.
- Prisma schema/client: `npm run db:generate`.

## Android Studio project

Set `VITE_API_BASE_URL` to the real production HTTPS API before packaging; production web builds reject a missing, localhost, or non-HTTPS API URL. Generate the native project with `npm run android:add` (first time), then build and synchronize the web app with `npm run android:sync`.

For an installable debug APK on Windows PowerShell:

```powershell
$env:VITE_API_BASE_URL = "https://api.<your-domain>/api"
npm --workspace apps/web run android:sync
Push-Location apps/web/android
.\gradlew.bat assembleDebug
Pop-Location
```

The APK is written to `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`. This debug APK is suitable for internal installation and testing. Before distributing a production release, configure a private signing keystore in local Gradle properties and build the signed release variant. The API URL is embedded into the web assets, so changing it requires another `android:sync` and APK build.

The debug APK currently in the repository workspace was built with the sample URL `https://api.sugar.example.com/api`; it is only for UI/offline testing and cannot sign in or synchronize factory records. Do not use it for factory operations. Before a production-connected APK can be built, provide the purchased domain name, host the Compose services on a Linux server, point DNS for the web host and `api` subdomain to that server, configure HTTPS, and enter the verified grade-wise opening and cumulative balances. The real API URL will be `https://api.<your-domain>/api`.

## Data and current scope

Approved records are immutable through ordinary API operations. Shift record numbers are database generated and duplicate production date/shift pairs are prevented. Inventory totals are derived grade-wise, and approved stock movements enter the ledger within a transaction. Offline records stay in IndexedDB on the device until the API confirms a sync. Conflicts remain in a local draft review panel and are not overwritten silently; server draft updates use a version check. Browser print from a record detail produces a register-style paper/PDF layout. Reports export as CSV or a multi-sheet Excel workbook.

The owner can assign an active chemist account to each shift. Registers cannot be submitted without that assignment, and the chemist assigned at submission is snapshotted on the record so later staffing changes do not rewrite history. Only that active assigned chemist can acknowledge the register. Owners must reassign a chemist and finish pending verifications before deactivating or changing an assigned chemist's role. Account password resets are audited and revoke the employee's refresh sessions.

The owner can configure grade labels and order, create production seasons with grade-wise opening stock and cumulative balances, and request a reasoned stock adjustment after every active shift on the latest production date has been approved. Adjustments are separate ledger movements and feed into the next shift's carried-forward opening balance.

This initial implementation still needs a production PostgreSQL instance, verified factory opening balances, deployed HTTPS domains, and operational acceptance with the Sugar House team. Do not enter live factory records until those are configured and the workflow is validated against the paper register.
