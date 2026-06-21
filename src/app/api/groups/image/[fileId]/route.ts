import { resolveServerAuth } from '@/server/auth';
import { loadGroupImage } from '@/server/groups/imageService';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ fileId: string }> },
) {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { fileId } = await ctx.params;
  const variant =
    new URL(req.url).searchParams.get('variant') === 'thumb' ? 'thumb' : 'main';

  const img = await loadGroupImage(fileId, variant);
  if (!img) {
    return new Response('Not found', { status: 404 });
  }

  return new Response(img.buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': img.contentType,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
