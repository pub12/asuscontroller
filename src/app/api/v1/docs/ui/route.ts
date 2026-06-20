import { swaggerUiHtml } from 'hazo_api/client';

export const GET = () =>
  new Response(
    swaggerUiHtml({ spec_url: '/api/v1/docs', title: 'NetWarden API' }),
    { headers: { 'Content-Type': 'text/html' } },
  );
