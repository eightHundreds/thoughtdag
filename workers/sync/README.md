# ThoughtDAG sync vault

The hosted backend for this fork: the same stateless `/api/*` proxy as
the original demo (`probe-models`, streaming, scholar search, link
snapshots) plus an R2 object store. The app talks to the vault with a
**sync URL** and a **storage-area name** the user invents. Vault bodies
are encrypted in the browser; this worker only stores opaque blobs.

The name is not a server password. Same URL + same name = the same
namespace. A different name is a different empty vault.

## One-time setup

```bash
cd workers/sync
wrangler login
wrangler r2 bucket create thoughtdag-sync
wrangler deploy
```

Pushing `workers/sync/**` or `functions/api/**` to `main` / `f/cloud-sync`
also deploys via `.github/workflows/sync-worker.yml`. The repo needs
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Until that Worker
is live, GitHub Pages calls `/api/probe-models` on a vault-only build
and gets `401 unauthorized` (CORS preflight also omits POST).

`GET /api/health` must return `{ ok: true, service: "thoughtdag-proxy" }`.
`GET /v1/health` is the vault canary and stays separate.

Do **not** set `SYNC_TOKEN`. Users type their own area name in the app.

## In the app

Open the backup / sync dialog and fill:

- **Sync URL** — the worker origin, e.g. `https://thoughtdag-sync.<account>.workers.dev`
- **Storage area** — any name the user invents (at least 8 characters)

Then **Save & test**, then **Sync now**.

## What is stored

Per storage-area namespace:

| key | contents |
|---|---|
| `prefs` | encrypted settings, including model keys |
| `project-<uuid>` | encrypted canvas snapshot (PDF originals omitted) |

Conflicts never merge graphs: the shared id keeps the remote copy, the
local work is saved as a new project named `… (conflict)`.

The same origin also serves the demo LLM proxy at `/api/*`, so a GitHub
Pages frontend can set `VITE_API_BASE` (or detect `*.github.io`) and
probe / generate through this worker instead of a same-origin `/api`.
