/** Raster inspection: full decode at admission, header-only probe on verified reads. */

import type sharp from 'sharp'
import type { Sharp } from 'sharp'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

/** Decoded metadata from a supported image. */
export interface DetectedImage {
  mediaType: ImageMediaType
  width: number
  height: number
}

const MEDIA_TYPES: Readonly<Record<string, ImageMediaType>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

type SharpFactory = typeof sharp
let loadSharp: () => Promise<SharpFactory> = async () => {
  const packageName: string = 'sharp'
  const module = await import(packageName) as unknown as { default: SharpFactory }
  return module.default
}

/**
 * Supply a packaged native-image loader without statically bundling Sharp's addon.
 * @param loader - lazy host-owned factory resolving the usable Sharp export.
 */
export function configureSharpLoader(loader: () => Promise<SharpFactory>): void {
  loadSharp = loader
}

async function imageMetadata(image: Sharp): Promise<DetectedImage> {
  const metadata = await image.metadata()
  const mediaType = MEDIA_TYPES[metadata.format as string]
  if (mediaType === undefined) {
    throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE')
  }
  return { mediaType, width: metadata.width, height: metadata.height }
}

/**
 * Parse a supported raster's header and return its intrinsic metadata without
 * decoding pixels. Digest-verified reads use this: admission already proved
 * that these exact bytes decode completely, so the read path only re-derives
 * the reference fields instead of paying the full-raster decode again.
 * @param data - complete encoded image bytes.
 * @returns verified format and dimensions.
 */
export async function probeImage(data: Uint8Array): Promise<DetectedImage> {
  try {
    const sharp = await loadSharp()
    return await imageMetadata(sharp(data, { failOn: 'error', limitInputPixels: false }))
  } catch (error) {
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE', { cause: error })
  }
}

/**
 * Fully decode a supported raster and return its intrinsic metadata.
 * @param data - complete encoded image bytes.
 * @param maxPixels - decoded-pixel admission limit.
 * @returns verified format and dimensions.
 */
export async function detectImage(data: Uint8Array, maxPixels?: number): Promise<DetectedImage> {
  try {
    const sharp = await loadSharp()
    const image = sharp(data, { failOn: 'error', limitInputPixels: false })
    const detected = await imageMetadata(image)
    if (maxPixels !== undefined && detected.width * detected.height > maxPixels) {
      throw new AttachmentError('Image exceeds the configured decoded-pixel limit.', 'IMAGE_TOO_MANY_PIXELS')
    }
    await image.raw().toBuffer()
    return detected
  } catch (error) {
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE', { cause: error })
  }
}
