# Search Skill: Direct API

Use the CLI for normal agent work. Call the SearXNG HTTP API directly when you need custom query parameters, quick inspection, or behavior the CLI does not expose yet.

Base URL:

```bash
SEARXNG_URL=${SEARXNG_URL:-http://localhost:8042}
```

## Search JSON

```bash
curl -s "$SEARXNG_URL/search?q=rust+async&format=json" | jq '.results[:3]'
```

With engines/categories:

```bash
curl -sG "$SEARXNG_URL/search" \
  --data-urlencode 'q=fish' \
  --data-urlencode 'format=json' \
  --data-urlencode 'engines=duckduckgo playwright,wikipedia' \
  --data-urlencode 'categories=general' | jq '.results[:5]'
```

## Config and engines

```bash
curl -s "$SEARXNG_URL/config" | jq '.categories'
curl -s "$SEARXNG_URL/config" | jq '.engines[] | select(.enabled) | {name,categories}'
```

## Health-ish checks

```bash
curl -I "$SEARXNG_URL/"
curl -s "$SEARXNG_URL/search?q=test&format=json&engines=duckduckgo%20playwright" | jq '.unresponsive_engines // []'
```

## Render server API

SearXNG Playwright engines call the host render server. You can inspect it directly:

```bash
curl -s http://localhost:8118/health
curl -s -X POST http://localhost:8118/render \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","wait":1}' | jq '{url,title,text: .text[:200]}'

curl -s -X POST http://localhost:8118/extract \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","selectors":["h1","p"],"wait":1}' | jq
```

If direct API calls fail, return to diagnostics:

```bash
searx doctor --text
```
