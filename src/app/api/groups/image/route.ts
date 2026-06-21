import { ok, fail, withRequestContext } from 'hazo_api';
import { resolveServerAuth } from '@/server/auth';
import { validateImageUpload, storeGroupImage } from '@/server/groups/imageService';

export const POST = withRequestContext(async (req: Request) => {
  const auth = await resolveServerAuth();
  if (!auth.authenticated) return fail('UNAUTHORIZED', 'Not authenticated');

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return fail('VALIDATION_FAILED', 'Could not parse form data');
  }

  const file = formData.get('file');
  if (!file || !(file instanceof Blob)) {
    return fail('VALIDATION_FAILED', 'No file provided');
  }

  const validation = validateImageUpload({ mime: file.type, size: file.size });
  if (!validation.ok) {
    return fail('VALIDATION_FAILED', (validation as { ok: false; reason: string }).reason);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let fileId: string;
  try {
    ({ fileId } = await storeGroupImage(buffer, file.type));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Validation errors from storeGroupImage map to VALIDATION_FAILED
    const isValidation =
      msg === 'Unsupported image type' || msg === 'Image exceeds 5MB';
    if (isValidation) {
      return fail('VALIDATION_FAILED', msg);
    }
    return fail('INTERNAL_ERROR', msg);
  }

  return ok({ image_file_id: fileId });
});
