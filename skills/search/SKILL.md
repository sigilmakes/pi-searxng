---
name: search
description: Search the web with SearXNG via the `searx` CLI. Always diagnose with `searx doctor --text` before first use. Compose searches from bash; use browser auth only when Google/challenges require it.
argument-hint: "[search query]"
---

# /search — Composable Web Search

Use `searx` from bash. JSON is default; add `--text` for readable output.

## First command

```bash
searx doctor --text
```

Follow doctor’s `Recommended search`. If service/render/browser are unhealthy, run the lifecycle command doctor suggests before searching.

## Default search

```bash
searx search "query" --text
searx search "query" --json | jq '.results[:3]'
```

If Google auth/profile is absent and Google is not required:

```bash
searx search "query" -e "duckduckgo playwright,wikipedia" -n 5 --text
```

## Browser auth

Only when Google matters or a challenge appears:

```bash
searx browser-auth "https://www.google.com/search?q=test"
searx render restart
searx doctor --text
```

`browser-auth` opens the browser and prompts the user automatically. The agent just waits for completion. No CAPTCHA solvers or stealth libraries.

## More when needed

- `docs/doctor.md` — interpreting diagnostics
- `docs/browser-auth.md` — auth/profile workflow
- `docs/composition.md` — pipelines and fetch/browse
- `docs/render.md` — render server and Playwright engines

`/searxng` is for status/lifecycle only; search/fetch happens through `searx`.
