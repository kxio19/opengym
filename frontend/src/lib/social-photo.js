const MAX_EDGE = 1080
const MAX_BYTES = 1024 * 1024

const canvasBlob = (canvas, quality) => new Promise((resolve, reject) => {
  canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not process photo')), 'image/jpeg', quality)
})

// Phone photos are commonly 4–12 MB. Decode once, then progressively lower JPEG quality and
// dimensions until the result fits the server's 1 MB ceiling. The first attempt is the agreed
// 1080 px / 0.8 quality; later attempts are only a safety net for unusually noisy images.
export async function resizeSocialPhoto(file) {
  if (!file || !/^image\/(jpeg|png)$/i.test(file.type)) throw new Error('Choose a JPEG or PNG photo')
  const bitmap = await createImageBitmap(file)
  try {
    const baseScale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    for (const [scale, quality] of [[baseScale, 0.8], [baseScale, 0.65], [baseScale * 0.85, 0.58], [baseScale * 0.7, 0.5]]) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await canvasBlob(canvas, quality)
      if (blob.size <= MAX_BYTES) return blob
    }
    throw new Error('The photo is still too large after resizing')
  } finally { bitmap.close() }
}
