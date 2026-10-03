export const MAX_EDGE = 2000
export const JPEG_QUALITY = 0.8

/** 等比縮放到最長邊 ≤ max，不放大 */
export function fitSize(w: number, h: number, max = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h))
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

/**
 * 截圖壓縮成 JPEG。最長邊 2000px 是為了讓 K 線圖的價格刻度在直式截圖上還看得清楚。
 * 不用 WebP：iOS Safari 的 canvas 不支援輸出 WebP，會悄悄改成 PNG。
 */
export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const { width, height } = fitSize(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('無法建立畫布')
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob || blob.type !== 'image/jpeg') throw new Error('瀏覽器無法輸出 JPEG，截圖未上傳')
    return blob
  } finally {
    bitmap.close()
  }
}
