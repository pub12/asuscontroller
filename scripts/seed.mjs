import { createHazoConnect, runMigrations } from 'hazo_connect/server';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

try {
  const adapter = createHazoConnect({
    type: 'sqlite',
    sqlite: {
      database_path: path.join(projectRoot, 'netwarden.sqlite'),
      driver: 'better-sqlite3',
    },
  });

  const applied = await runMigrations(adapter, {
    directory: path.join(projectRoot, 'migrations'),
  });

  console.log(`[seed] migrations applied: ${applied.length}`);
  if (applied.length > 0) {
    for (const m of applied) {
      console.log(`  - ${m.name}`);
    }
  }
} catch (err) {
  console.error('[seed] Migration failed:', err);
  process.exit(1);
}
