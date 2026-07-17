import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Walk upward from this file to find the monorepo root (the package.json declaring workspaces).
// Works both from source (tsx) and from the bundled dist file.
function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const pkg = resolve(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const json = JSON.parse(readFileSync(pkg, 'utf8'));
        if (json.workspaces) return dir;
      } catch {
        /* ignore malformed package.json while walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot();

// Resolve a possibly-relative path against the repo root.
export function fromRoot(p: string): string {
  return resolve(REPO_ROOT, p);
}
