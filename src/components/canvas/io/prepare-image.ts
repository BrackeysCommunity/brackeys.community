/**
 * Shrinks an image to fit the upload pipeline before it's sent:
 * `uploadImageToStorage` refuses anything over 5 MB and never resizes, and
 * vault screenshots are routinely 5–15 MB PNGs. Runs on the main thread for
 * now; written against `OffscreenCanvas` where it exists so the file-I/O
 * worker can take it over unchanged.
 */

import { PROFILE_PROJECT_IMAGE_MAX_SIZE_BYTES as MAX_UPLOAD_BYTES } from "@/lib/image-upload-policy";

/** Long-edge steps: the first is the target, the rest are for PNGs that won't fit. */
const EDGES = [2560, 1920, 1280] as const;

export class ImageTooLargeError extends Error {
  constructor() {
    super("That image is too large to upload, even scaled down.");
  }
}

type Surface = {
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  encode: (type: string, quality?: number) => Promise<Blob>;
};

function surface(width: number, height: number): Surface {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context) {
      return { context, encode: (type, quality) => canvas.convertToBlob({ type, quality }) };
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2D canvas available.");
  return {
    context,
    encode: (type, quality) =>
      new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Encode failed."))), type, quality),
      ),
  };
}

function draw(bitmap: ImageBitmap, edge: number): Surface & { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const target = surface(width, height);
  target.context.imageSmoothingQuality = "high";
  target.context.drawImage(bitmap, 0, 0, width, height);
  return { ...target, width, height };
}

function hasTransparency(target: Surface & { width: number; height: number }): boolean {
  const { data } = target.context.getImageData(0, 0, target.width, target.height);
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return true;
  return false;
}

function renamed(file: File, blob: Blob): File {
  const ext = blob.type.split("/")[1] === "jpeg" ? "jpg" : blob.type.split("/")[1];
  const stem = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${stem}.${ext}`, { type: blob.type });
}

/**
 * The file as it should be uploaded: untouched when it's already small
 * enough, else downscaled to 2560px on the long edge and re-encoded as WebP.
 * GIFs pass through (re-encoding loses the animation). Where WebP can't be
 * encoded (Safari hands back a PNG), opaque images go to JPEG and
 * transparent ones stay PNG, stepping down in size until they fit.
 */
export async function prepareImage(file: File): Promise<File> {
  if (file.type === "image/gif") {
    if (file.size > MAX_UPLOAD_BYTES) throw new ImageTooLargeError();
    return file;
  }

  const bitmap = await createImageBitmap(file);
  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (file.size <= MAX_UPLOAD_BYTES && longEdge <= EDGES[0]) return file;

    let opaque: boolean | null = null;
    for (const edge of EDGES) {
      const target = draw(bitmap, edge);
      let blob = await target.encode("image/webp", 0.9);
      if (blob.type !== "image/webp") {
        opaque ??= !hasTransparency(target);
        blob = opaque ? await target.encode("image/jpeg", 0.85) : blob;
      }
      if (blob.size <= MAX_UPLOAD_BYTES) return renamed(file, blob);
    }
    throw new ImageTooLargeError();
  } finally {
    bitmap.close();
  }
}
