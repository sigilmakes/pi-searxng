---
name: search
description: Search the web with SearXNG via the `searx` CLI. Compose into bash pipelines for complex retrieval. Manage the service with `/searxng`.
argument-hint: "[search query]"
---

# /search — Composable Web Search

**Search for: $ARGUMENTS**

## The `searx` CLI

`searx` is the primary interface — a CLI that returns structured JSON by default, human-readable with `--text`. It composes into bash pipelines.

### Search

```bash
searx search "query"                     # JSON, 8 results (default)
searx search "query" --text              # Human-readable
searx search "query" --json              # Raw SearXNG response (pipe to jq)
searx search "query" -c it               # IT/tech category
searx search "query" -c news -t week     # Recent news
searx search "query" -c science           # Academic/scientific
searx search "query" -e wikipedia,mdn    # Specific engines only
searx search "query" -l en               # English results
searx search "query" -n 3 -p 2          # 3 results, page 2
```

**Options:** `-c` categories, `-e` engines, `-t` time range (day/week/month/year), `-l` language, `-n` limit, `-p` page, `--json` raw, `--text` readable

### Fetch

```bash
searx fetch "https://example.com"             # Full page as markdown (JSON)
searx fetch "https://example.com" --text      # Just the text content
searx fetch "https://example.com" -n 3000     # First 3000 chars
searx fetch "https://example.com" -n 3000 -o 3000  # Next 3000 chars (paginate)
```

### Service Management

```bash
searx status           # Health check (JSON)
searx status --text    # Human-readable
searx start            # Start SearXNG
searx stop             # Stop SearXNG
searx restart          # Restart (clears engine suspensions)
searx engines          # List engines by category (JSON)
searx engines --text   # Human-readable
```

From the pi TUI: `/searxng` (with subcommands: status, start, stop, restart, engines)

## Composing Search Pipelines

The shade's bash tool is a sandbox. Compose `searx` into pipelines the way Perplexity's SDK composes primitives — but in bash, not Python.

### Extract URLs from results

```bash
searx search "rust async" -c it -n 5 | jq -r '.results[].url'
```

### Chain search → fetch

```bash
URL=$(searx search "tokio rust" -c it -n 1 --json | jq -r '.results[0].url')
searx fetch "$URL" --text -n 5000
```

### Search multiple categories

```bash
for cat in general news; do
  searx search "climate policy" -c $cat -n 2 --text
  echo "---"
done
```

### Filter results programmatically

```bash
searx search "python asyncio" -c it --json | \
  jq '[.results[] | select(.engines | contains(["stackoverflow"]))] | .[:3]'
```

### Paginate through long documents

```bash
# First 5000 chars
searx fetch "$URL" -n 5000 --text
# Next 5000 chars
searx fetch "$URL" -n 5000 -o 5000 --text
```

### Check engine health before searching

```bash
searx status --text   # Quick health check
# If engines are suspended:
searx restart         # Clears all suspensions
```

### Combine with other tools

```bash
# Search, extract URL, fetch page, grep for a pattern
URL=$(searx search "CVE-2025-1234" --json | jq -r '.results[0].url')
searx fetch "$URL" --text | grep -i "patch\|fix\|update"
```

## Output Formats

### JSON (default)

`search` returns:

```json
{
  "query": "rust async",
  "total": 1234,
  "returned": 8,
  "page": 1,
  "results": [
    {
      "title": "Rust Programming Language",
      "url": "https://...",
      "snippet": "Rust is a systems...",
      "engines": ["wikipedia", "startpage"],
      "date": "2025-06-01T...",
      "category": "general",
      "score": 1.0
    }
  ],
  "answers": [],
  "suggestions": ["related query"],
  "unresponsive": [{"engine": "google", "reason": "suspended"}]
}
```

`fetch` returns:

```json
{
  "url": "https://...",
  "total_length": 12450,
  "offset": 0,
  "shown_length": 5000,
  "has_more": true,
  "next_offset": 5000,
  "content": "Markdown text..."
}
```

### --json (raw)

Passes SearXNG's unmodified response. Useful for accessing fields not in the structured output:

```bash
searx search "test" --json | jq '.unresponsive_engines'
```

## Categories & Engines

### Common Categories

| Category       | Content                          |
| -------------- | -------------------------------- |
| `general`      | Web search (default)             |
| `news`         | News articles                    |
| `it`           | Technical/programming content     |
| `science`      | Academic papers                   |
| `images`       | Image search                     |
| `videos`       | Video search                     |
| `files`        | File/torrent search              |
| `social media` | Social posts                     |
| `music`        | Music search                     |

### Useful Engines

| Engine          | Category | Good for                        |
| --------------- | -------- | ------------------------------- |
| `wikipedia`     | general  | Encyclopedic overviews          |
| `stackoverflow` | it       | Programming Q&A                 |
| `github`       | it/repos | Code repositories               |
| `mdn`           | it       | Web/JS docs                     |
| `arxiv`         | science  | Preprints                       |
| `pubmed`        | science  | Biomedical papers               |
| `pypi`          | it       | Python packages                 |
| `docker hub`   | it       | Container images                |
| `qwant`         | general   | Privacy-respecting web search   |
| `brave`         | general   | Web search (may get suspended)  |

**Tip:** Use `-e` to target specific engines when you know which source has the answer. Reduces noise and avoids engine suspensions:

```bash
searx search "Array.prototype.map" -e mdn
searx search "express middleware" -e stackoverflow
```

## Engine Suspensions

Engines get suspended when they detect automated access (CAPTCHAs, rate limits). This is normal. Suspended engines recover after cooldown periods.

**Signs of suspension:** `searx search` returns fewer results than expected, or the `unresponsive` list is long.

**Fix:** `searx restart` — clears all suspensions immediately.

**Avoid:** Use specific engines (`-e`) instead of relying on suspended general engines. The `it`, `science`, and `news` categories use engines that are more resistant to suspension.

## Direct API Access

For use cases beyond the CLI, SearXNG's JSON API is at `http://localhost:8042/search`:

```bash
curl -s "http://localhost:8042/search?q=rust+async&format=json&categories=it" | jq '.results[:3]'
curl -s "http://localhost:8042/search?q=test&format=json" | jq '{results: (.results | length), unresponsive: [.unresponsive_engines[] | .[0]]}'
curl -s "http://localhost:8042/config" | jq '.categories'
```

## Fetching Pages

`searx fetch` uses markitdown for HTML→markdown conversion. It handles:
- Web pages (HTML)
- PDFs, DOCX, PPTX, and other document formats
- Wikipedia articles (clean extraction)

For JavaScript-heavy SPAs that markitdown can't render, try:
```bash
# The /summarize skill may handle JS-heavy pages better
node ~/.pi/agent/skills/summarize/to-markdown.mjs "$URL" --tmp
```

For Wikipedia summaries specifically:
```bash
curl -s "https://en.wikipedia.org/api/rest_v1/page/summary/Article_Title" | jq '.extract'
```