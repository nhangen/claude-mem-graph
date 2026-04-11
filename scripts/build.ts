import { build } from 'esbuild';

await build({
  entryPoints: ['src/mcp-server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: 'scripts/mcp-server.cjs',
  external: ['better-sqlite3'],
  minify: false,
  sourcemap: true,
});

console.log('Built scripts/mcp-server.cjs');
