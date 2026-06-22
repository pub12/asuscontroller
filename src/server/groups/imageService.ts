'server-only';

import path from 'path';
import { mkdir, writeFile, readFile, access } from 'fs/promises';
import { randomUUID } from 'crypto';
import { uploadProcessedImage } from 'hazo_images/server';

// ── Storage root ──────────────────────────────────────────────────────────────
const FILES_ROOT =
  process.env.DARYLWEB_FILES_ROOT ?? path.join(process.cwd(), 'data', 'group-images');

// ── Allowed MIME types and size limit ─────────────────────────────────────────
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// ── FileManager interface (thin local seam) ───────────────────────────────────
// Implements the FileManager duck-type required by hazo_images/server.
// uploadFile receives a Buffer from hazo_images; remotePath is fileId (main)
// or ./fileId__thumb_128.webp (thumbnail). Both resolve to a flat directory
// under FILES_ROOT.
class LocalFileManager {
  async uploadFile(
    source: Buffer | string,
    remotePath: string,
    _options?: Record<string, unknown>,
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    try {
      const absPath = path.join(FILES_ROOT, remotePath);
      await mkdir(path.dirname(absPath), { recursive: true });
      const buf = Buffer.isBuffer(source) ? source : Buffer.from(source);
      await writeFile(absPath, buf);
      return { success: true, data: { remotePath } };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateImageUpload(meta: {
  mime: string;
  size: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!ALLOWED_MIME.has(meta.mime)) {
    return { ok: false, reason: 'Unsupported image type' };
  }
  if (meta.size <= 0 || meta.size > MAX_BYTES) {
    return { ok: false, reason: 'Image exceeds 5MB' };
  }
  return { ok: true };
}

// ── Store ─────────────────────────────────────────────────────────────────────

/**
 * Validate + process + store a group image.
 *
 * hazo_images writes two files under FILES_ROOT:
 *   main:  {fileId}                        (WebP, no extension)
 *   thumb: {fileId}__thumb_128.webp        (./fileId__thumb_128.webp resolves to same dir)
 *
 * @throws Error with a human-readable message on validation or storage failure.
 */
export async function storeGroupImage(
  buffer: Buffer,
  mime: string,
): Promise<{ fileId: string }> {
  const validation = validateImageUpload({ mime, size: buffer.length });
  if (!validation.ok) {
    throw new Error((validation as { ok: false; reason: string }).reason);
  }

  const fileId = randomUUID();
  await uploadProcessedImage(new LocalFileManager(), buffer, fileId, {
    stripExif: true,
    autoRotate: true,
    maxDimension: 512,
    webp: true,
    thumbnails: [128],
  });

  return { fileId };
}

// ── Load ──────────────────────────────────────────────────────────────────────

/** UUID-only characters: hex digits and hyphens, exactly 36 chars */
const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * Load a stored group image by fileId and variant.
 *
 * Returns null if fileId is invalid, not found, or traversal-unsafe.
 */
export async function loadGroupImage(
  fileId: string,
  variant: 'main' | 'thumb' = 'main',
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!UUID_RE.test(fileId)) return null;

  const absPath =
    variant === 'thumb'
      ? path.join(FILES_ROOT, `${fileId}__thumb_128.webp`)
      : path.join(FILES_ROOT, fileId);

  try {
    await access(absPath);
  } catch {
    return null;
  }

  try {
    const buffer = await readFile(absPath);
    // Main file is stored without extension but always WebP (hazo_images with webp:true).
    // Thumb always ends with .webp.
    const contentType = 'image/webp';
    return { buffer, contentType };
  } catch {
    return null;
  }
}
