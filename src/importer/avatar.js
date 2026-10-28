/**
 * Avatar file helpers shared by the installer, registry and HTTP routes.
 *
 * Bundled avatars may be PNG, JPEG or WebP. The installed folder keeps the
 * original image format instead of relabelling JPEG bytes as `avatar.png`.
 */

import { stat } from 'node:fs/promises'
import { extname, join } from 'node:path'

export const AVATAR_BASENAMES = ['avatar.png', 'avatar.jpg', 'avatar.jpeg', 'avatar.webp']

/** Map a source avatar path to its installed basename (JPEG aliases → .jpg). */
export function avatarFileNameFor(sourcePath) {
  const extension = extname(String(sourcePath ?? '')).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'avatar.jpg'
  if (extension === '.webp') return 'avatar.webp'
  return 'avatar.png'
}

/** First existing avatar file in an installed expert folder (or undefined). */
export async function findAvatarFile(dir) {
  for (const name of AVATAR_BASENAMES) {
    try {
      if ((await stat(join(dir, name))).isFile()) return name
    } catch { /* try next */ }
  }
  return undefined
}

/** Determine an image content type from magic bytes, never from a filename. */
export function imageContentType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return undefined
}
