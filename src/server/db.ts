import { createHazoConnect } from 'hazo_connect/server';
import type { HazoConnectAdapter } from 'hazo_connect/server';
import path from 'path';

let _adapter: HazoConnectAdapter | null = null;

export function getDb(): HazoConnectAdapter {
  if (!_adapter) {
    _adapter = createHazoConnect({
      type: 'sqlite',
      sqlite: {
        database_path: path.join(process.cwd(), 'darylweb.sqlite'),
        driver: 'better-sqlite3',
      },
    });
  }
  return _adapter;
}
