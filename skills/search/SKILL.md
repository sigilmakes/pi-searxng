---
name: search
description: Search the web with SearXNG via the `searx` CLI. Compose into bash pipelines for complex retrieval. Use browser rendering for JS pages. Manage the service with `/searxng`.
argument-hint: "[search query]"
---

# /search — Composable Web Search

**Search for: $ARGUMENTS**

Use `searx` from bash. It returns JSON by default and human-readable output with `--text`.

## Search

```bash
searx search "query"                       # JSON, 8 results
searx search "query" --text                # Human-readable
searx search "query" --json | jq '.'       # Raw SearXNG response
searx search "query" -c it -n 3            # IT category, 3 results
searx search "query" -c news -t week       # Recent news
searx search "query" -e wikipedia,mdn      # Specific engines
searx search "query" -e "duckduckgo playwright" --text
```

Options: `-c` categories, `-e` engines, `-t` time range, `-l` language, `-n` limit, `-p` page, `--json`, `--text`.

## Fetch / Browse

```bash
searx fetch "https://example.com" --text          # markitdown/auto browser fallback
searx fetch "https://example.com" --browser --text # force Playwright render
searx fetch "$URL" -n 3000 -o 3000                # paginate

searx browse "https://example.com" --text         # browser-render visible text
searx browse "https://example.com" --extract "h1,h2"
```

Browser rendering uses `playwright-core` directly. First run:

```bash
searx doctor
searx config set browserPath "$(which chromium)"  # if doctor says browser unavailable
# or install Playwright's browser on conventional systems:
npx playwright install chromium
```

## Human-auth state

If a site presents a CAPTCHA/login challenge, use human-auth state:

```bash
searx browser-auth "https://www.google.com/search?q=test"
searx render restart
```

`browser-auth` opens a headed persistent browser profile, waits until the page looks authenticated, then saves storage/profile paths into config. No tmux/Enter dance. The renderer will reuse that profile for later searches.

## Render server for SearXNG engines

Playwright-backed SearXNG engines call a host render server:

```bash
searx render start
searx render status
searx restart
searx search "rust async" -e "google playwright,duckduckgo playwright,wikipedia" --text
```

Current browser engines:

- `duckduckgo playwright` — working and recommended for browser-rendered general search
- `brave playwright` — partial; useful but can be sparse
- `google playwright` — enabled; works best after `searx browser-auth` creates a persistent profile

## Service Management

```bash
searx doctor --text
searx status --text
searx start
searx stop
searx restart
searx render status
searx render restart
searx engines --text
```

From the pi TUI: `/searxng [status|start|stop|restart|engines]`.

## Composition Patterns

### Extract URLs

```bash
searx search "rust async" -c it -n 5 | jq -r '.results[].url'
```

### Search → fetch

```bash
URL=$(searx search "tokio rust" -c it -n 1 --json | jq -r '.results[0].url')
searx fetch "$URL" --text -n 5000
```

### Search → browser-render first result

```bash
URL=$(searx search "complex js app docs" -n 1 | jq -r '.results[0].url')
searx browse "$URL" --text | head -80
```

### Filter results programmatically

```bash
searx search "python asyncio" -c it --json | \
  jq '[.results[] | select(.url | contains("docs.python.org"))] | .[:3]'
```

### Use targeted engines to avoid noise

```bash
searx search "Array.prototype.map" -e mdn --text
searx search "express middleware" -e stackoverflow --text
searx search "rust async" -e "duckduckgo playwright" --text
```

## Engine Suspensions

Suspensions happen when remote engines block plain HTTP scrapers. Prefer targeted engines or the Playwright-backed DuckDuckGo engine. `searx restart` clears SearXNG's suspension cache but does not bypass remote challenges.

## Direct API Access

```bash
curl -s "http://localhost:8042/search?q=rust+async&format=json&categories=it" | jq '.results[:3]'
curl -s "http://localhost:8042/config" | jq '.categories'
```
