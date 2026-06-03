---
name: search
description: Search the web with SearXNG via the `searx` CLI. Compose searches from bash; use browser auth only when Google/challenges require it.
argument-hint: "[search query]"
---

# /search — Composable Web Search

Use `searx` from bash. JSON is default; add `--text` for readable output.

## Search

```bash
searx search "query" --text
searx search "query" --json | jq '.results[:3]'
searx search "query" -c news -n 5 --text
searx search "query" -e "duckduckgo playwright,wikipedia" -n 5 --text
```

Options: `-c` categories, `-e` engines, `-t` time range, `-l` language, `-n` limit, `-p` page, `--json`, `--text`.

## Fetch / Browse

```bash
searx fetch "https://example.com" --text
searx fetch "https://example.com" --browser --text
searx browse "https://example.com" --extract "h1,h2" --text
```

## Browser auth

Only when Google matters or a challenge appears:

```bash
searx browser-auth "https://www.google.com/search?q=test"
searx render restart
```

`browser-auth` opens the browser and prompts the user automatically. The agent just waits for completion. No CAPTCHA solvers or stealth libraries.

## When something is broken

If search returns 0 results unexpectedly or engines are down, diagnose:

```bash
searx doctor --text
```

Follow doctor's suggestions. Common fixes:

```bash
searx start          # SearXNG not responding
searx render start   # render server stopped
searx restart        # engine suspensions
```

## More when needed

- `docs/doctor.md` — interpreting diagnostics
- `docs/browser-auth.md` — auth/profile workflow
- `docs/composition.md` — pipelines and fetch/browse
- `docs/render.md` — render server and Playwright engines
- `docs/api.md` — direct SearXNG/render HTTP API calls

`/searxng` is for status/lifecycle only; search/fetch happens through `searx`.