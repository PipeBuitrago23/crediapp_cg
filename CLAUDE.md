# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

**Fases 1-6 are done.** Fase 1: async SQLAlchemy models for all 7 tables in [backend/models.py](backend/models.py), wired to Postgres via [backend/database.py](backend/database.py), Alembic migrations in [backend/alembic/](backend/alembic/) (initial revision `171fd750526d`). Fase 2: French amortization engine in [backend/finance.py](backend/finance.py), Pydantic v2 schemas in [backend/schemas.py](backend/schemas.py), and `POST /clientes`, `POST /celulares`, `POST /ventas` in [backend/routers/](backend/routers/). Fase 3: `GET /admin/dashboard`, `GET /creditos/{id}/liquidacion-anticipada`, and Gmail SMTP notifications via [backend/email_service.py](backend/email_service.py) fired as a `BackgroundTasks` job at the end of `POST /ventas`. Fase 4: the advisor wizard in [frontend/](frontend/) (see below) plus two backend additions it needed — `GET /clientes?documento=` and `GET /celulares?estado=` list endpoints, and CORS middleware in `main.py`. Fase 5: admin auth (username/password + JWT, `administradores` table, seeded only via [backend/create_admin.py](backend/create_admin.py) — no public registration endpoint) and client auth (4-digit OTP emailed on request, `otp_clientes` table, looked up by `documento`) in [backend/routers/auth.py](backend/routers/auth.py), backed by [backend/security.py](backend/security.py); a payment endpoint `POST /creditos/{id}/cuotas/{numero}/pagar` (admin-only, flips `Credito.estado` to `Finalizado` once no `cuota` remains `Pendiente`); full banner CRUD in [backend/routers/banners.py](backend/routers/banners.py) (`GET /banners/activos` public, the rest admin-only); an admin search endpoint `GET /creditos?cliente_id=` / `?imei=`; a client-portal router [backend/routers/portal.py](backend/routers/portal.py) (`GET /portal/mis-creditos`, ownership-checked `GET /portal/liquidacion-anticipada/{id}`); and the two frontend pages `frontend/admin.html`/`js/admin.js` and `frontend/cliente.html`/`js/cliente.js`. `GET /admin/dashboard` and `GET /creditos/{id}/liquidacion-anticipada` — both open with no auth through Fase 3 — are now admin-only (verified nothing in the Fase 4 wizard depended on either being public). Fase 6: production-safe [backend/start.sh](backend/start.sh) (runs `alembic upgrade head` then `uvicorn` without `--reload`, bound to Railway's injected `$PORT`) as the backend Dockerfile's `CMD`, with `docker-compose.yml` overriding `command:` back to `--reload` for local dev; `DATABASE_URL` scheme auto-normalized from `postgresql://` to `postgresql+asyncpg://` in [backend/database.py](backend/database.py) (and reused by `alembic/env.py`) so Railway's Postgres plugin URL works without manual edits; CORS origins now come from an optional `CORS_ORIGINS` env var (comma-separated, defaults to `*`); and a new [frontend/Dockerfile](frontend/Dockerfile) so the frontend deploys as its own Railway service (see "Despliegue en Railway" below). `POST /ventas` is the core transactional endpoint — see "Architecture" below for the conventions it depends on. Actual Railway deployment has **not** been performed — the Railway CLI isn't available in this environment, so only the deployment artifacts were prepared and verified locally (see below); check what actually exists first rather than assuming when picking up from here.

**Post-Fase-6 addition: a third role, `vendedor`** (not in the original 6-phase roadmap — added after the user decided sales registration should be a separate role from admin, not something admin does directly). Individual seller accounts (`vendedores` table, mirrors `administradores`, plus an `activo` toggle) managed admin-side via [backend/routers/vendedores.py](backend/routers/vendedores.py) (`POST`/`GET`/`PATCH`, no `DELETE`, no self-registration — same bootstrap reasoning as admin, except no script is needed since an admin already exists before the first vendedor does). `POST /auth/vendedor/login` reuses `AdminLoginRequest`. `Venta.vendedor_id` (nullable FK, no backfill) attributes every sale to the vendedor who made it; `POST /ventas` now requires a vendedor token specifically (`Depends(get_current_vendedor)`) — not admin, not staff-generic — to keep that attribution meaningful and to enforce the admin/vendedor separation the user asked for. `GET`/`POST /clientes` and `GET`/`POST /celulares` — previously fully public — now require `get_current_staff` (admin OR vendedor), closing a real PII exposure now that staff auth exists. The advisor wizard ([frontend/index.html](frontend/index.html) + `js/wizard.js`) gained a login gate identical in shape to `admin.html`/`cliente.html`'s.

The Fase 4 wizard was verified by exercising the exact API call sequence it makes (search/create cliente, list inventory, create retoma, submit venta) end-to-end via curl, and by confirming all static assets serve with correct MIME types from a local dev server. The Fase 5 backend was verified the same way plus a full docker-compose run: admin login/JWT issuance, `GET /admin/dashboard` returning 401 with no/garbage token and 200 with a valid one, `GET /creditos` filtered by both `cliente_id` and `imei` with nested `cuotas` correctly eager-loaded, paying off every cuota on a test crédito and confirming both the `Finalizado` transition and the updated dashboard totals, the OTP request/verify cycle (including the anti-enumeration 204 for a nonexistent `documento`, single-use/expiry rejection, and that an admin token 401s on client-only routes and vice versa), the `/portal/liquidacion-anticipada/{id}` ownership check (404 on someone else's crédito), and the full banner CRUD lifecycle including the public `/banners/activos` filter. Both frontend pages were checked for ID/element-reference consistency and served with correct MIME types, but — like the Fase 4 wizard — have **not** been click-tested in an actual browser (no browser-automation tool is available in this environment). Open [frontend/index.html](frontend/index.html), [frontend/admin.html](frontend/admin.html), and [frontend/cliente.html](frontend/cliente.html) via a local server (see Commands) and click through all three before treating any of them as fully verified.

Fase 6 was verified by building and running both Dockerfiles standalone (`docker build` + `docker run`, no docker-compose) to simulate how Railway actually invokes them: the backend container connected to Postgres with a deliberately un-prefixed `postgresql://` URL to confirm the asyncpg normalization works, ran `alembic upgrade head` successfully on boot, and bound to a non-default `$PORT`; the frontend container served `admin.html`/`cliente.html`/`index.html` correctly on a non-default `$PORT`; `CORS_ORIGINS` was confirmed to default to `*` when unset and to correctly restrict `Access-Control-Allow-Origin` when set. `docker compose up --build` was re-run afterward to confirm local dev (hot-reload, manual migrations) is byte-for-byte unaffected. None of this touched an actual Railway project — there is no Railway CLI in this environment, so real deployment (creating the project, adding the Postgres plugin, setting env vars, confirming the assigned domains) is still unverified and up to you.

The `vendedor` role was verified the same way as Fase 5's auth work, against the running docker-compose stack: created a vendedor as admin, logged in as that vendedor, confirmed the token works on `/clientes`/`/celulares`/`POST /ventas` but 401s on every admin-only route (`/admin/dashboard`, `/creditos`, `/vendedores`); confirmed an **admin** token now also works on `/clientes`/`/celulares` (staff-generic) but 401s on `POST /ventas` (vendedor-only — the actual separation the user asked for); registered a full sale as the vendedor and confirmed `vendedor_id` landed on the row and shows up nested in the admin's `GET /creditos`; deactivated the vendedor and confirmed login then fails even with the correct password; confirmed the 3 pre-existing test `Venta` rows (`vendedor: null`) still serialize fine. Frontend changes (login gate on `index.html`/`wizard.js`, Vendedores section on `admin.html`/`admin.js`) were checked for ID/element-reference consistency and correct MIME types — not click-tested in a real browser, same caveat as everything else frontend in this project.

## Commands

Run the stack with Docker Compose (matches the intended Postgres setup):
```
docker-compose up --build
```
Backend: http://localhost:8000 · Postgres: localhost:5432 (db `crediapp_db`, user `admin` — credentials are hardcoded in [docker-compose.yml](docker-compose.yml) for local dev only). Note `docker-compose.yml` overrides the `web` service's `command:` to keep `--reload`; without that override, [backend/Dockerfile](backend/Dockerfile)'s own `CMD` (`start.sh`) is the production path Railway actually runs — no `--reload`, migrations applied automatically on boot, bound to `$PORT`. To sanity-check the production path locally without Railway: `docker build -t crediapp-backend ./backend && docker run -e PORT=8080 -e DATABASE_URL=... -e JWT_SECRET=... -p 8080:8080 crediapp-backend` (same for `./frontend`, which has no required env vars beyond `PORT`).

Run Alembic migrations (inside the `web` container, so it picks up `DATABASE_URL` from docker-compose):
```
docker compose exec web alembic upgrade head
docker compose exec web alembic revision --autogenerate -m "description"
docker compose exec web alembic downgrade -1
```

Run the backend directly without Docker (needs `backend/.env` copied from [backend/.env.example](backend/.env.example), pointing `DATABASE_URL` at `localhost` instead of the `db` hostname):
```
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

There is no test suite or linter configured yet.

Serve the frontend for local dev (plain static files, no build step — ES modules require an http:// origin, so don't just double-click `index.html`):
```
cd frontend
python -m http.server 5500
```
Then open http://localhost:5500. It calls the backend at `http://localhost:8000` (see `frontend/js/config.js`), so run both at once.

## Architecture

### Frontend (Fase 4)

[frontend/](frontend/) is a static site (plain HTML + ES modules + Tailwind via CDN, no bundler/framework, per the project constraints) meant to be served directly — by a plain dev server locally, and by its own Railway service in production via [frontend/Dockerfile](frontend/Dockerfile) (Fase 6; deliberately **not** wired into the FastAPI container — see "Despliegue en Railway" below for why and for the CORS implication).

- `index.html` — the 4-step advisor wizard (Cliente → Equipo Nuevo → Liquidación → Crédito), Tailwind CDN + jsPDF CDN (`<script src=".../jspdf.umd.min.js">`, exposed as `window.jspdf.jsPDF`).
- `js/config.js` — `API_BASE_URL` and `IMEI_CHECK_URL`. **`IMEI_CHECK_URL` is a placeholder** (`https://example.com/verificar-imei`) — a real official-lookup URL was deliberately not guessed; it must be filled in with the correct site for your country before this feature is usable.
- `js/api.js` — thin `fetch` wrapper (`api.get`/`api.post`) that surfaces FastAPI's `{"detail": "..."}` error bodies as a `message` on a thrown `ApiError`.
- `js/imei.js` — `copiarImeiYVerificar(imei)`: copies to clipboard via the Clipboard API, then opens `IMEI_CHECK_URL` in a new tab. Used both for the selected "equipo nuevo" and for a freshly-typed retoma IMEI.
- `js/pdf.js` — `generarPdfResumen(estado, resultado)`: renders the contract summary entirely from data already in memory (wizard state + the `POST /ventas` response) — no network calls, matching the "PDF only in the advisor's browser" constraint.
- `js/wizard.js` — the only stateful module (a single `estado` object); orchestrates step validation/navigation and the API calls. Deliberately **not** split further per step — the wizard is small enough that one orchestrator file is simpler than four step-specific modules.

Wizard flow and why it's staged the way it is:
- **Step 1** resolves (finds-or-creates) the `cliente` when advancing to Step 2, not at final submit — `GET /clientes?documento=` first, and only `POST /clientes` if nothing matched. This gives fail-fast feedback on duplicate-documento/email errors instead of surfacing them only after the whole wizard is filled out.
- **Step 2** lists existing inventory (`GET /celulares?estado=Disponible`) rather than creating a new phone — matches the spec's "Selección desde el inventario". There is currently no dedicated flow for bulk-adding store inventory ahead of a sale; `POST /celulares` is the only way phones enter inventory, whether it's new stock or a trade-in.
- **Step 3**'s retoma sub-form calls `POST /celulares` when advancing to Step 4 (only if the toggle is on) — a trade-in phone is inventory too, it just doesn't exist as a row until the advisor evaluates and enters it here (see the `celulares`-is-shared-table convention below). If the advisor abandons the wizard after this point, that `celular` row is orphaned in `Disponible` state — harmless, it just becomes normal sellable/re-tradeable inventory.
- **Step 4** does not duplicate the French-amortization math in JS — it only previews the simple subtraction (`valor_venta - abonos - retoma`) client-side, and gets the real `cuotas` table from the `POST /ventas` response itself, which is fast enough to render synchronously as "the projection."
- **CORS defaults to wide open** (`allow_origins=["*"]` in `main.py`) but is now driven by the optional `CORS_ORIGINS` env var (Fase 6, comma-separated) — set it once the frontend's Railway domain is known to restrict it for real; unset, local dev behaves exactly as before.

The full target Postgres schema (exact column types for `clientes`, `celulares`, `ventas`, `detalle_pagos`, `creditos`, `cuotas`, `publicidad_banners`) is documented in [README.md](README.md) and implemented as-is in [backend/models.py](backend/models.py), with one deliberate addition beyond the README's literal DDL: `creditos.venta_id` and `detalle_pagos.venta_id` are UNIQUE, enforcing the intended one-credit/one-payment-detail-per-sale relationship at the DB level (flag it if this should be reverted). Fase 5 added two more tables not in the README's original DDL: `administradores` (id, nombre, email unique, contrasena_hash, creado_en) and `otp_clientes` (id, cliente_id FK, codigo, expira_en, usado, creado_en) — see [backend/alembic/versions/fbfe218873c7_add_admin_and_otp_tables.py](backend/alembic/versions/fbfe218873c7_add_admin_and_otp_tables.py). The `vendedor` addition added a third, `vendedores` (id, nombre, email unique, contrasena_hash, activo, creado_en) plus `ventas.vendedor_id` (nullable FK) — see [backend/alembic/versions/24fed4682696_add_vendedores_table.py](backend/alembic/versions/24fed4682696_add_vendedores_table.py).

Alembic is configured for async migrations (`backend/alembic/env.py` uses `async_engine_from_config` + `run_sync`, following SQLAlchemy's documented asyncio pattern) — reads `DATABASE_URL` from the environment rather than `alembic.ini`, so it works both inside docker-compose and locally via `.env`.

Endpoints are organized as one `APIRouter` per resource under [backend/routers/](backend/routers/) (`clientes.py`, `celulares.py`, `ventas.py`, `creditos.py`, `admin.py`, `auth.py`, `portal.py`, `banners.py`, `vendedores.py`), included into `app` in `main.py` — keep following this pattern rather than growing `main.py` into a monolith.

- **Three JWT-bearing roles share one generalized decode path**: `backend/security.py`'s private `_decodificar(credenciales, tipos_esperados: frozenset[str]) -> tuple[int, str]` is the single place that checks a token's signature and `type` claim; `get_current_admin`/`get_current_cliente`/`get_current_vendedor` each call it with a one-element frozenset and discard the `tipo`, while `get_current_staff` passes `{"admin", "vendedor"}` for the handful of routes both roles need (`clientes.py`, `celulares.py`). `_decodificar` has no callers outside `security.py`, so this internal signature is safe to keep evolving as roles are added — don't copy-paste a fourth near-identical `get_current_X`/`_decodificar` pair if a fourth role ever shows up.
- **Role separation is enforced by *which* dependency a route uses, not by a role hierarchy** — `POST /ventas` requires `get_current_vendedor` specifically (an admin token 401s there), and `routers/creditos.py`/`routers/vendedores.py`/`routers/admin.py` require `get_current_admin` specifically (a vendedor token 401s there). Only `clientes.py`/`celulares.py` accept either via `get_current_staff`. When adding a new endpoint, default to the narrowest role unless there's a concrete reason two roles need it.

### Frontend (Fase 5)

`admin.html`/`js/admin.js` and `cliente.html`/`js/cliente.js` follow the exact same conventions as the Fase 4 wizard (plain ES modules, Tailwind CDN, one stateful orchestrator file per page, no framework/bundler) — see the Fase 4 subsection above for the reasoning. `js/api.js` gained module-level `setToken`/`clearToken` (mirroring the single-`estado`-object pattern rather than threading a token through every call) plus `patch`/`delete` methods for the banner CRUD; 401 handling deliberately stays out of `api.js` and lives in each page's own call sites, because admin.js and cliente.js need to bounce to different login views on an expired/invalid token. `js/format.js` holds the one shared `formatoMoneda()` helper both new pages need (`wizard.js` keeps its own copy — not worth a cross-cutting refactor for one function). The wizard (`index.html`/`js/wizard.js`) later gained this exact same login-gate/`manejarLlamada` shape once `vendedor` auth was added, making all three frontend pages structurally identical in how they handle sessions.

**A `manejarLlamada`-wrapped 401 means "expired session," not "wrong credentials"** — don't route a login/verify call itself through it. `login_admin`, `login_vendedor`, and `verificar_otp` all return a real `401` for bad credentials/codes, which is a different situation from an already-authenticated request's token expiring; `iniciarSesion()` in `admin.js`/`wizard.js` and `verificarOtp()` in `cliente.js` deliberately use a plain `try/catch` instead, so the user sees "Credenciales inválidas"/"Código inválido o expirado" rather than a misleading "Tu sesión expiró."

### Despliegue en Railway (Fase 6)

Two Railway services, one project — deliberately not one combined service (see the frontend-hosting note above): the backend has an existing, tested Dockerfile/docker-compose setup, and splitting keeps that untouched rather than restructuring the Docker build context to a repo-root context that could serve both.

1. **Postgres**: add Railway's managed Postgres plugin to the project — do not deploy the `postgres:15-alpine` image from `docker-compose.yml` (that's local-dev-only). The plugin's connection string uses the plain `postgresql://` scheme; [backend/database.py](backend/database.py) auto-rewrites it to `postgresql+asyncpg://` at import time, so paste it into `DATABASE_URL` as-is.
2. **Backend service**: root directory `backend/` (it already has its own `Dockerfile`, so Railway auto-detects it — no `railway.json` needed). Set env vars manually in the Railway dashboard: `DATABASE_URL` (from the Postgres plugin), `JWT_SECRET` (generate one, e.g. `python -c "import secrets; print(secrets.token_hex(32))"` — the app refuses to start without it), `SMTP_USER`/`SMTP_PASSWORD` (optional — omitted means emails silently no-op, never breaks a sale/payment), `CORS_ORIGINS` (optional, leave unset until the frontend service's domain is known). Railway injects `PORT` automatically; [backend/start.sh](backend/start.sh) (the Dockerfile's `CMD`) runs `alembic upgrade head` then binds `uvicorn` to it — no manual migration step on deploy, unlike local dev.
3. **Frontend service**: root directory `frontend/` (has its own `Dockerfile`, same auto-detect). No required env vars — Railway injects `PORT` and [frontend/Dockerfile](frontend/Dockerfile) binds `python -m http.server` to it. **Before this is usable**, manually edit `frontend/js/config.js`'s `API_BASE_URL` to the backend service's Railway domain (assigned after its first deploy — can't be known ahead of time, same reasoning as why `IMEI_CHECK_URL` was left a placeholder rather than guessed) and redeploy.
4. **Close the loop**: once both domains exist, set the backend's `CORS_ORIGINS` to the frontend's domain(s) (comma-separated if `admin.html`/`cliente.html`/`index.html` should all be reachable from the same origin, which they are here since they're one static site) and redeploy the backend.
5. **Create the first admin** the same way as local dev, just against the Railway environment: `railway run python create_admin.py <email> <password> <nombre>` from `backend/` (needs the Railway CLI, which isn't available in this environment — someone with CLI access and the project linked needs to run this once).

None of this has been exercised against a real Railway project (no CLI/account in this environment) — steps 1-5 are the intended sequence, verified only insofar as the underlying Dockerfiles/env-var behavior were tested locally (see Project Status above).

Conventions established in Fase 2/3 that later phases must stay consistent with:
- **`tasa_interes_mensual` is stored and accepted as a percentage, not a fraction** (e.g. `2.5` means 2.5%/month), because it's a `NUMERIC(5,2)` column and storing a fraction directly (`0.025`) would lose precision on rounding to 2 decimal places. [backend/finance.py](backend/finance.py)'s `tasa_mensual_a_fraccion()` divides by 100 before applying the French-amortization formula — any new code that touches interest math must convert through this same helper, not assume the raw column value is already `i`.
- **`Venta.celular_nuevo_id` and `DetallePago.valor_retoma_id` both point at the same `celulares` table** — there's no separate "trade-in" table. A trade-in phone is registered exactly like new inventory via `POST /celulares` (default `estado='Disponible'`) and only becomes a trade-in by being referenced as `valor_retoma_id` on a `POST /ventas` call, which flips it to `estado='Retomado'`.
- **`POST /ventas` wraps all reads and writes in one `async with db.begin():` block**, including the initial validation lookups (not just the inserts) — that's what makes an `HTTPException` raised mid-validation trigger a full rollback instead of a partial write. Follow the same shape for any future endpoint that mutates more than one table. Row locks (`with_for_update=True`) are taken on the `celulares` rows being sold/retomados to prevent two concurrent sales from double-booking the same phone.
- **The last `cuota` in a generated table absorbs the rounding residue** so `SUM(monto_capital)` always equals `monto_financiado` exactly — don't "fix" the last row's amount without preserving that invariant.
- **Liquidación anticipada's "interés del mes en curso" is defined as the `monto_interes` of the earliest still-`Pendiente` cuota** for that crédito (`routers/creditos.py`), not a live recalculation from today's date — it trusts the precomputed amortization schedule. If a `cuota` payment ever gets registered late/out of order, this still just looks at the lowest `numero_cuota` with `estado='Pendiente'`.
- **`GET /admin/dashboard` computes its 3 metrics as scalar subqueries in a single `SELECT`** (one round trip, aggregation done in Postgres) rather than fetching rows into Python — keep new dashboard metrics in that same query rather than adding separate round trips.
- **SMTP credentials are never hardcoded**: `SMTP_USER`/`SMTP_PASSWORD` come from a **repo-root** `.env` (gitignored, not `backend/.env`) via `${SMTP_USER}` substitution in `docker-compose.yml` — see [.env.example](.env.example). [backend/email_service.py](backend/email_service.py) treats missing credentials as a no-op (logs a warning, doesn't raise), so a sale never fails because email isn't configured — preserve that fire-and-forget behavior in any code that calls it.
- **Client JWTs live 7 days, admin JWTs live 12h** (`EXPIRACION_CLIENTE`/`EXPIRACION_ADMIN` in `backend/security.py`) — the client portal is read-only (no action moves money or edits account data), so a longer session avoids repeating the OTP on every visit without a real fraud risk; the admin panel can mutate data (mark cuotas paid, edit banners) so it keeps a same-workday-length session. No server-side revocation exists for either (stateless JWT, checked by signature+`type` only) — a compromised device stays valid until it expires or `JWT_SECRET` is rotated (which invalidates every session, admin and client).
- **JWTs carry a `type` claim (`"admin"` | `"cliente"`)** so a token minted for one portal can never be replayed against the other's routes — [backend/security.py](backend/security.py)'s `get_current_admin`/`get_current_cliente` check both signature and `type`, and deliberately never hit the DB (stateless trade-off, avoids a round trip per request; routes that need actual row data fetch it themselves using the returned id). Unlike SMTP, `JWT_SECRET` is read with `os.environ["JWT_SECRET"]` (hard-fails if unset) — an empty secret is a vulnerability, not a degradable feature. `HTTPBearer(auto_error=False)` is used instead of the default so a *missing* Authorization header also 401s through our own handler instead of FastAPI's default 403 — the frontend's uniform "401 → clear token → bounce to login" handling depends on this.
- **Admin accounts only come from [backend/create_admin.py](backend/create_admin.py)** (`docker compose exec web python create_admin.py <email> <password> <nombre>`), run manually like Alembic — there is intentionally no public admin-registration endpoint.
- **Client OTP is requested by `documento`, not email/phone**, even though the original brief said "correo o teléfono registrado": `Cliente.telefono` has no unique constraint, so it isn't a safe lookup key, while `documento` is guaranteed unique and is the same identifier the Fase 4 wizard already searches by. The OTP is always emailed to the cliente's *stored* address, never a user-supplied one. `POST /auth/cliente/solicitar-otp` always returns `204` regardless of whether the `documento` matched anything, to avoid leaking which documentos are registered.
- **Any endpoint serializing a SQLAlchemy relationship (e.g. `Credito.cuotas`, `Venta.cliente`) must eager-load it with `selectinload`** — async sessions never lazy-load implicitly, and this is new territory as of Fase 5 (every earlier response was either flat or hand-built from a dict, e.g. `POST /ventas`'s `CuotaRead`). `routers/creditos.py`'s `calcular_liquidacion()` is factored out specifically so the admin and client-portal liquidación-anticipada routes share one implementation instead of duplicating the math.
- **A read that happens before a mutating `async with db.begin():` must go *inside* that block, not before it.** SQLAlchemy's async session auto-begins a transaction on first use, so a bare `db.scalar(...)` ahead of an explicit `db.begin()` raises `InvalidRequestError: A transaction is already begun on this Session`. Hit this in `routers/auth.py`'s OTP endpoints during Fase 5 verification and fixed it by moving the lookup inside the block — the same trap `POST /ventas` already avoided by construction (see the bullet above on wrapping validation + writes together).

Architectural decisions baked into the spec that are easy to accidentally violate:
- **PDF generation is client-side only** (jsPDF/html2pdf in the advisor's browser). Never add a server-side PDF endpoint — this is a deliberate Railway resource-cost constraint, not a gap to fill.
- **IMEI validation is a redirect**, not an integration: copy the IMEI to the clipboard and link out to the official country lookup site. Do not wire up a third-party IMEI API/database.
- **No passwords for the client portal** — access is a 4-digit OTP sent by email only (implemented in Fase 5; there is no "magic link" variant, just the code).
- **`cuotas` rows are precomputed and persisted** at credit-creation time by the French-amortization engine, not computed on the fly at query time.
- **Early payoff (liquidación anticipada) waives all future interest** — amount due is remaining principal + interest accrued in the current month only (exact formula in "Lógica Financiera Obligatoria" below). This needs its own calculation path, separate from summing remaining `cuotas`.
- Backend is async end-to-end (FastAPI + asyncpg/SQLAlchemy async engine) — avoid blocking calls in request handlers to stay within Railway's RAM/CPU budget.
- Frontend is vanilla JS + Tailwind CSS with no build step or framework (no React/Vue/bundler) — keep it that way unless the user changes direction.

---

Eres un Ingeniero de Software Full-Stack experto en arquitecturas ligeras, seguridad y sistemas financieros. Vas a ayudarme a programar paso a paso una Web App para una tienda de celulares que vende equipos a crédito combinando un sistema de retoma (*trade-in*).

## 🎯 Restricciones de Infraestructura y Rendimiento
- **Entorno de despliegue:** Railway. El código debe ser altamente eficiente en memoria RAM y CPU para evitar sobrecostos de hosting.
- **Backend:** Python con FastAPI. Usaremos programación asíncrona (`async/await`) y consultas optimizadas.
- **Base de Datos:** PostgreSQL nativo. Las operaciones financieras críticas deben encapsularse adecuadamente.
- **Frontend:** Interfaz limpia del lado del cliente utilizando JavaScript nativo y Tailwind CSS para máxima velocidad de carga.
- **Generación de PDFs:** Se procesará en el Frontend (usando jsPDF o html2pdf) para no saturar el almacenamiento ni los recursos del servidor.
- **Validación de IMEI en retoma:** Se integrará mediante un enlace externo optimizado en la UI (redirigiendo con el IMEI copiado al sitio de consulta oficial del país), evitando bases de datos o servicios de terceros que ralenticen la app.

## 🧮 Lógica Financiera Obligatoria
1. **Estructura del Crédito (Sistema de Amortización Francés):** Las cuotas mensuales deben ser fijas. Se calculan con la fórmula:
   C = (P * i) / (1 - (1 + i)^-n)
   Donde:
   - P = Monto financiado (Valor Venta - Abonos - Valor Retoma).
   - i = Tasa de interés mensual decimal.
   - n = Número total de cuotas.
2. **Cálculo de Liquidación Anticipada:** Si un cliente desea cancelar la totalidad de su saldo antes de tiempo, el sistema NO cobrará los intereses de las cuotas futuras. El valor a pagar será igual a:
   [Saldo Total del Capital Pendiente] + [Intereses generados estrictamente en el mes en curso].

## 📬 Sistema de Notificaciones y Acceso
- **Email Corporativo:** Uso de SMTP con Gmail (vía App Passwords del backend) para notificar de forma automática al cliente la creación de su cuenta y los recibos de pago de sus cuotas. El email es obligatorio en el registro del cliente.
- **Acceso del Cliente:** El portal del cliente no utilizará contraseñas tradicionales. Al ingresar su correo o teléfono registrado, se enviará un código OTP temporal de 4 dígitos o un link seguro a su email de Gmail para iniciar sesión automáticamente.

---

## 🗺️ Mapa de Ruta de Desarrollo por Fases
Trabajaremos de forma iterativa. No avances a la siguiente fase hasta que yo confirme que la anterior está completamente funcional y testeada.

### Fase 1: Backend - Configuración, Base de Datos y Modelos
- Configurar el entorno de FastAPI e integrar la conexión asíncrona a PostgreSQL (con SQLAlchemy o Tortoise-ORM).
- Crear las migraciones y modelos exactos para las tablas de: Clientes, Celulares, Ventas, Detalle_Pagos, Creditos, Cuotas y Publicidad_Banners.

### Fase 2: Backend - Motor Financiero y Endpoints Principales
- Desarrollar la lógica en Python que reciba el monto financiado, tasa y cuotas, y genere la tabla de amortización francesa exacta guardando cada cuota de forma individual.
- Desarrollar los endpoints (`POST`, `GET`) para crear clientes, agregar celulares al inventario y procesar una venta completa.

### Fase 3: Backend - Dashboard Administrativo, Liquidación y Correo
- Crear los endpoints de agregación para el Dashboard del Administrador:
  - Monto Total Colocado (Sumatoria de montos financiados).
  - Monto Pendiente por Cobrar (Suma del capital restante de cuotas pendientes).
  - Intereses Reales Generados (Suma de intereses recaudados en cuotas pagadas).
- Crear el endpoint de cálculo dinámico para el pago anticipado de un crédito.
- Configurar el servicio SMTP para despachar notificaciones automáticas de pago vía Gmail.

### Fase 4: Frontend - Interfaz de Asesor (Formulario Wizard)
- Diseñar con Tailwind CSS el asistente de ventas responsive (Mobile-First) dividido en los 4 pasos definidos (Cliente, Equipo Nuevo, Liquidación con switch de retoma/abono y Proyección del crédito).
- Implementar la lógica JS para autocompletar el IMEI copiado al portapapeles y redirigir al enlace externo de validación de IMEI.
- Implementar la descarga del contrato/resumen en PDF renderizado exclusivamente desde el navegador del asesor.

### Fase 5: Frontend - Portal Administrativo y Portal de Clientes
- Desarrollar la vista responsive del administrador para visualizar los estados de cuenta individuales y registrar pagos de cuotas.
- Desarrollar la interfaz simplificada de inicio de sesión OTP para el cliente.
- Desarrollar el panel minimalista del cliente (Próximo pago, progreso del crédito, cotización de liquidación anticipada y el banner de publicidad administrable).

### Fase 6: Preparación para Despliegue en Railway
- Generar el archivo `Dockerfile`, `requirements.txt` y variables de entorno (`.env`) necesarias para un despliegue transparente y de bajo consumo en Railway.
