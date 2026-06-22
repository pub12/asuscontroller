import { generateOpenAPI } from 'hazo_api';
import { ALL_ROUTES } from '@/lib/api_routes';

export const GET = () =>
  Response.json(
    generateOpenAPI({
      info: { title: 'DarylWeb API', version: 'v1' },
      servers: [{ url: 'http://localhost:3400' }],
      routes: ALL_ROUTES,
    }),
  );
