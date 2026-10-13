import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electron from 'electron';

const temporary = mkdtempSync(join(tmpdir(), 'lolping-performance-'));
try {
  const entry = join(temporary, 'assets.cjs');
  await build({ entryPoints: ['tools/performance/assets.ts'], outfile: entry, bundle: true, platform: 'node', external: ['electron'] });
  const result = spawnSync(electron, [entry, resolve(process.argv[2] ?? '.'), join(temporary, 'data'), ...process.argv.slice(3)], {
    stdio: 'inherit', timeout: 45_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temporary, { recursive: true, force: true, maxRetries: 3 });
}
