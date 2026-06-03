# Search Skill: Browser Auth

Google may challenge automated sessions. The supported answer is a headed persistent browser profile completed by Willow, then reused by the render server.

## When to run auth

Run auth only when one of these is true:

- Willow asks for Google-backed results.
- `google playwright` returns CAPTCHA, unusual-traffic, consent, or login pages.
- `searx doctor --text` says the browser profile is absent and Google matters for the task.

For ordinary web search, skip auth and use:

```bash
searx search "query" -e "duckduckgo playwright,wikipedia" -n 5 --text
```

## Auth flow

```bash
searx browser-auth "https://www.google.com/search?q=test"
searx render restart
searx doctor --text | grep -E 'Browser profile|Recommended search'
searx search "playwright browser automation" -e "google playwright" -n 5 --text
```

`browser-auth` opens a headed persistent Chromium profile, watches until the page looks authenticated, then saves both storage state and profile paths into `~/.pi/agent/searxng/config.json`.

If a CAPTCHA/consent screen appears, the opened browser prompts the user automatically. The agent does not need a separate confirmation step; just wait for `searx browser-auth` to finish, then restart render. Do not use CAPTCHA-solving services, stealth bypass libraries, or site-specific monkey patches.
