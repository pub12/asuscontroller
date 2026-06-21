import path from 'path';
import { rm } from 'fs/promises';
import {
  validateImageUpload,
  storeGroupImage,
  loadGroupImage,
} from '@/server/groups/imageService';

// 1×1 PNG (base64)
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

export async function GET() {
  const pngBuffer = Buffer.from(PNG_B64, 'base64');
  const FILES_ROOT =
    process.env.NETWARDEN_FILES_ROOT ??
    path.join(process.cwd(), 'data', 'group-images');

  let createdFileId: string | null = null;

  try {
    // ── roundtrip_ok ─────────────────────────────────────────────────────────
    let roundtrip_ok = false;
    try {
      const { fileId } = await storeGroupImage(pngBuffer, 'image/png');
      createdFileId = fileId;
      const fileIdTruthy = !!fileId;
      const main = await loadGroupImage(fileId, 'main');
      const mainOk =
        main !== null &&
        main.buffer.length > 0 &&
        main.contentType.startsWith('image/');
      const thumb = await loadGroupImage(fileId, 'thumb');
      const thumbOk = thumb !== null && thumb.buffer.length > 0;
      roundtrip_ok = fileIdTruthy && mainOk && thumbOk;
    } catch {
      roundtrip_ok = false;
    }

    // ── reject_non_image_ok ───────────────────────────────────────────────────
    const reject_non_image_ok =
      validateImageUpload({ mime: 'application/pdf', size: 1000 }).ok === false;

    // ── reject_oversize_ok ────────────────────────────────────────────────────
    const reject_oversize_ok =
      validateImageUpload({ mime: 'image/png', size: 99 * 1024 * 1024 }).ok === false;

    // ── traversal_safe_ok ─────────────────────────────────────────────────────
    const traversalResult1 = await loadGroupImage('../../etc/passwd');
    const traversalResult2 = await loadGroupImage('not-a-uuid');
    const traversal_safe_ok = traversalResult1 === null && traversalResult2 === null;

    // ── missing_returns_null_ok ───────────────────────────────────────────────
    const missingResult = await loadGroupImage('00000000-0000-0000-0000-000000000000');
    const missing_returns_null_ok = missingResult === null;

    const all_ok =
      roundtrip_ok &&
      reject_non_image_ok &&
      reject_oversize_ok &&
      traversal_safe_ok &&
      missing_returns_null_ok;

    return Response.json({
      ok: true,
      all_ok,
      roundtrip_ok,
      reject_non_image_ok,
      reject_oversize_ok,
      traversal_safe_ok,
      missing_returns_null_ok,
    });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    // Clean up: delete the stored files for the created fileId
    if (createdFileId) {
      try {
        // Both files live flat in FILES_ROOT (no subdirectory), so delete by name
        const mainPath = path.join(FILES_ROOT, createdFileId);
        const thumbPath = path.join(FILES_ROOT, `${createdFileId}__thumb_128.webp`);
        await rm(mainPath, { force: true });
        await rm(thumbPath, { force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
}
