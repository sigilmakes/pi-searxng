# Development Notes

## Install/update loop

```bash
cd ~/Projects/Work/pi-searxng
git push
pi update git:github.com/sigilmakes/pi-searxng
```

Do not use relative-path pi installs for this package. The supported package source is `git:github.com/sigilmakes/pi-searxng`.

## Smoke tests

```bash
npm run typecheck

node --input-type=module - <<'JS'
import { createJiti } from 'jiti/static';
const jiti = createJiti(import.meta.url, { interopDefault: true });
const ext = await jiti.import('./src/index.ts');
console.log(typeof ext.default);
JS

searx doctor --text
searx search "fish" --text
searx search "rust async" -e "duckduckgo playwright,wikipedia" -n 5 --text
searx fetch https://example.com --browser -n 80 --text
```

After Docker/SearXNG settings changes:

```bash
pi update git:github.com/sigilmakes/pi-searxng
searx restart
searx doctor --text
```

After render/browser/auth changes:

```bash
searx render restart
searx doctor --text
```

## Editing conventions

- TypeScript source uses 4 spaces.
- Keep the extension thin and the CLI/service modules explicit.
- Prefer small functions and plain data objects over framework-shaped abstractions.
- Commit one logical change at a time.
