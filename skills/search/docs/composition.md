# Search Skill: Composition

`searx` is designed for bash pipelines. JSON is the default; `--text` is for humans.

## Extract URLs

```bash
searx search "rust async" -e "duckduckgo playwright,wikipedia" -n 5 | jq -r '.results[].url'
```

## Search then fetch

```bash
URL=$(searx search "tokio rust" -c it -n 1 --json | jq -r '.results[0].url')
searx fetch "$URL" --text -n 5000
```

## Search then browser-render

```bash
URL=$(searx search "complex js app docs" -n 1 | jq -r '.results[0].url')
searx browse "$URL" --text | head -80
```

## Filter programmatically

```bash
searx search "python asyncio" -c it --json | \
  jq '[.results[] | select(.url | contains("docs.python.org"))] | .[:3]'
```

## Target engines to reduce noise

```bash
searx search "Array.prototype.map" -e mdn --text
searx search "express middleware" -e stackoverflow --text
searx search "fish" -e "duckduckgo playwright,wikipedia" --text
```
