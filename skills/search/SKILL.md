---
name: search
description: Search the web with SearXNG and fetch readable page content. The web_search and web_fetch tools provide native access — use them directly. This skill provides advanced guidance for direct API access when you need more control.
argument-hint: "[search query]"
---

# /search — Web Search via SearXNG

**Search for: $ARGUMENTS**

## Native Tools

Two tools are available natively — no bash scripting needed:

- **web_search** — Query SearXNG with full parameter support (categories, engines, time range, language, pagination)
- **web_fetch** — Convert URLs to clean markdown via markitdown (handles HTML, PDF, DOCX, etc.)

Use these tools directly. They handle service lifecycle automatically (starting SearXNG if needed).

## Service Management

The `/searxng` command provides lifecycle control:

- `/searxng` or `/searxng status` — Show service status and engine health
- `/searxng start` — Start the service
- `/searxng stop` — Stop the service
- `/searxng restart` — Restart (clears engine suspensions)
- `/searxng engines` — List all enabled engines by category

If `web_search` reports engine suspensions, use `/searxng restart` to clear them.

## Advanced: Direct API Access

For use cases where the tools don't provide enough control, SearXNG's JSON API is available at `http://localhost:8042/search`.

### Search Parameters

| Parameter    | Values                                                  | Note                        |
| ------------ | ------------------------------------------------------- | --------------------------- |
| `q`          | (any)                                                   | Required. URL-encode.       |
| `format`     | `json`                                                  | Required for API use.      |
| `categories` | `general`, `news`, `images`, `it`, `science`, `files`... | Comma-separated.            |
| `engines`    | `google`, `brave`, `wikipedia`, `stackoverflow`...      | Comma-separated.            |
| `time_range` | `day`, `week`, `month`, `year`                          | Filter by recency.          |
| `language`   | `en`, `de`, `fr`, `es`...                               | Result language.            |
| `pageno`     | `1`, `2`, `3`...                                        | Pagination.                 |
| `safesearch` | `0` (off), `1` (moderate), `2` (strict)                |                              |

### Example Queries

```bash
# Basic search
curl -s "http://localhost:8042/search?q=rust+async&format=json" | jq '.results[:3]'

# Technical category
curl -s "http://localhost:8042/search?q=python+requests&format=json&categories=it" | jq '.results[:3]'

# Recent news
curl -s "http://localhost:8042/search?q=ai+regulation&format=json&categories=news&time_range=week" | jq '.results[:3]'

# Specific engines only
curl -s "http://localhost:8042/search?q=pydantic+validator&format=json&engines=stackoverflow,github" | jq '.results[:3]'

# Check engine health
curl -s "http://localhost:8042/search?q=test&format=json" | jq '{results: (.results | length), unresponsive: [.unresponsive_engines[] | .[0]]}'

# Available categories and engines
curl -s "http://localhost:8042/config" | jq '.categories'
```

### Response Structure

```json
{
  "query": "search terms",
  "number_of_results": 1234,
  "results": [
    {
      "url": "https://...",
      "title": "Result Title",
      "content": "Snippet text...",
      "engines": ["engine1", "engine2"],
      "score": 1.0,
      "category": "general",
      "publishedDate": "2025-01-15T..."
    }
  ],
  "answers": [],
  "infoboxes": [],
  "suggestions": ["related query"],
  "corrections": [{"correct": "suggestion"}],
  "unresponsive_engines": [["engine", "reason"]]
}
```

**Key fields:**
- `results[].engines` — which engines contributed this result (more = higher confidence)
- `results[].publishedDate` — available for news/blog results
- `answers` — instant answers (calculations, definitions)
- `infoboxes` — structured knowledge panels
- `suggestions` — related search queries
- `unresponsive_engines` — engines that failed (important for debugging)

### Engine Suspension

Engines get suspended when they detect automated access (CAPTCHAs, rate limits). This is normal and self-healing — engines recover after cooldown periods. If many engines are suspended:

```bash
# Restart clears all suspensions immediately
/searxng restart

# Or via docker
docker compose -f ~/.pi/agent/git/github.com/sigilmakes/pi-searxng/docker/docker-compose.yaml restart
```

## Configuration

The SearXNG configuration lives in the package repository:

```
docker/searxng/settings.yml     — Server config, formats, redis
docker/searxng/limiter.toml     — Rate limiting (disabled for local use)
docker/docker-compose.yaml       — Docker service definition
```

The Docker Compose uses `user: "0:0"` and disables ownership changes for local convenience. Redis-compatible caching is via Valkey on port 6379 (internal).

## Fetching Pages

For reading web content, prefer `web_fetch` which uses markitdown for conversion. For advanced cases:

```bash
# Quick text extraction via markitdown (same tool web_fetch uses)
uvx --from 'markitdown[pdf]' markitdown "https://example.com/article"

# Wikipedia API (cleaner for summaries)
curl -s "https://en.wikipedia.org/api/rest_v1/page/summary/Page_Title" | jq '.extract'

# For JavaScript-heavy SPAs, use /summarize which may handle them better
```