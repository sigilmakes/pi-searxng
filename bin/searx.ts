#!/usr/bin/env node
/**
 * searx CLI launcher — uses jiti (same as pi) to run the TypeScript CLI.
 * No build step needed.
 */

import { createJiti } from "jiti/static";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, { interopDefault: true });
jiti.import(path.join(__dirname, "..", "src", "cli.ts"));