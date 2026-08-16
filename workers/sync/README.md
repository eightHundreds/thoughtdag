# ThoughtDAG sync vault

A tiny Cloudflare Worker + R2 object store. The app talks to it with a
**sync URL** and a **storage-area name** the user invents. Bodies are
encrypted in the browser; this worker only stores opaque blobs.

The name is not a server password. Same URL + same name = the same
namespace. A different name is a different empty vault.

## One-time setup

```bash
cd workers/sync
wrangler login
wrangler r2 bucket create thoughtdag-sync
wrangler deploy
```

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
