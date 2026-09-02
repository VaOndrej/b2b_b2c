import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Composing twice must not rewrite files whose content did not change.
 *
 * compose.mjs wipes `dist` and copies the whole base theme on every run, so all
 * ~550 files come back with a new mtime even when nothing about them changed.
 * `shopify theme dev` watches mtimes, not content, so one compose queues ~550
 * uploads; Shopify answers `THROTTLED` on `themeFilesUpsert` and the dev server
 * then serves "Failed to Upload Theme Files" or a bare 404 until it is killed
 * and restarted. That looks exactly like a broken theme and has cost real time
 * misdiagnosing it.
 *
 * Asserted on the artefact, not on the CLI: compose into a scratch directory
 * twice and require that the second run leaves untouched files untouched. Any
 * future step that rewrites a file unconditionally trips this on its own.
 */

const OUT = 'tmp/compose-idempotence';

test('a second compose does not rewrite files it did not change', async () => {
  test.setTimeout(180_000);

  const snapshot = (dir: string) => {
    const out: Record<string, { mtimeMs: number; size: number }> = {};
    const walk = (rel: string) => {
      for (const entry of readdirSync(join(dir, rel) || dir)) {
        const childRel = rel ? join(rel, entry) : entry;
        const st = statSync(join(dir, childRel));
        if (st.isDirectory()) walk(childRel);
        else out[childRel] = { mtimeMs: st.mtimeMs, size: st.size };
      }
    };
    walk('');
    return out;
  };

  rmSync(OUT, { recursive: true, force: true });
  execFileSync('node', ['themes/build/compose.mjs', 'horizon', '--out', OUT], { stdio: 'pipe' });
  const first = snapshot(OUT);
  expect(Object.keys(first).length, 'compose produced no files').toBeGreaterThan(100);

  // A file system can report the same second twice; make the boundary visible.
  await new Promise((r) => setTimeout(r, 1200));

  execFileSync('node', ['themes/build/compose.mjs', 'horizon', '--out', OUT], { stdio: 'pipe' });
  const second = snapshot(OUT);

  expect(Object.keys(second).sort(), 'the two runs produced different file lists').toEqual(
    Object.keys(first).sort(),
  );

  const rewritten = Object.keys(first).filter((f) => second[f].mtimeMs !== first[f].mtimeMs);
  const contentChanged = rewritten.filter((f) => second[f].size !== first[f].size);

  expect(
    rewritten.length,
    `the second compose rewrote ${rewritten.length}/${Object.keys(first).length} files whose ` +
      `content did not change (${contentChanged.length} of them differ in size, i.e. are genuinely ` +
      `new). Every one of those is an upload the dev server does not need: ` +
      `${JSON.stringify(rewritten.slice(0, 8))}`,
  ).toBe(0);

  rmSync(OUT, { recursive: true, force: true });
});
