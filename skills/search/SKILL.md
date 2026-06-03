---
name: search
description: Search the web with SearXNG via the `searx` CLI. Compose searches from bash; use browser auth only when Google/challenges require it.
argument-hint: "[search query]"
---

# /search — Composable Web Search

Use `searx` from bash. JSON is default; add `--text` for readable output.

## Engine names matter

SearXNG has both plain and Playwright-backed engines. The Playwright versions render through a real browser and survive anti-bot challenges. **Always use the Playwright engine names.**

| User says | Use this engine | Never this |
|-----------|----------------|------------|
| Google    | `google playwright` | `google` (always suspended) |
| DuckDuckGo | `duckduckgo playwright` | `duckduckgo` (fragile) |
| Brave | `brave playwright` | `brave` (sparse, optional) |

## Search

```bash
# Default general search
searx search "query" --text

# When the user asks for Google specifically
searx search "query" -e "google playwright" -n 5 --text

# Broader search with multiple engines
searx search "query" -e "google playwright,duckduckgo playwright,wikipedia" -n 5 --text

# Without Google (if auth is absent or unnecessary)
searx search "query" -e "duckduckgo playwright,wikipedia" -n 5 --text

# JSON for pipelines
searx search "query" --json | jq '.results[:3]'

# Other options
searx search "query" -c news -n 5 --text
```

Options: `-c` categories, `-e` engines, `-t` time range, `-l` language, `-n` limit, `-p` page, `--json`, `--text`.

## Fetch / Browse

```bash
searx fetch "https://example.com" --text
searx fetch "https://example.com" --browser --text
searx browse "https://example.com" --extract "h1,h2" --text
```

## Google browser auth

Google Playwright works without auth for casual use. If Google serves a CAPTCHA or "unusual traffic" page, the agent needs to create a persistent browser profile:

```bash
searx browser-auth "https://www.google.com/search?q=test"
searx render restart
```

`browser-auth` opens a headed Chromium window and waits for the user to complete any challenge. The agent just waits for it to finish. After restart, `google playwright` will use the authenticated profile.

No CAPTCHA solvers or stealth bypass libraries.

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