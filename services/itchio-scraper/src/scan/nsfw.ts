import { env, pipeline, RawImage } from "@huggingface/transformers";

/**
 * In-process NSFW classifier: a small ViT (~86M params) that runs in
 * milliseconds per cover on CPU via the bundled ONNX runtime. Deliberately
 * free of config imports so the Docker build can warm the model cache
 * (warm-nsfw.ts) without a DATABASE_URL.
 *
 * Failure never breaks a scan tick: if the model can't load or a cover
 * can't be classified, the score is null and hashing proceeds — bump
 * DETECTOR_VERSION in scan.ts to re-score once the model is back.
 */

export const NSFW_MODEL = "AdamCodd/vit-base-nsfw-detector";

// Bake the weights into the image next to the code; the default cache path
// lives inside node_modules and a cron container would re-download ~90MB
// from HF every tick.
env.cacheDir = new URL("../../.model-cache", import.meta.url).pathname;

type Classifier = (image: RawImage) => Promise<Array<{ label: string; score: number }>>;

let classifierPromise: Promise<Classifier | null> | null = null;

async function loadClassifier(): Promise<Classifier | null> {
  try {
    const pipe = await pipeline("image-classification", NSFW_MODEL, { dtype: "q8" });
    return pipe as unknown as Classifier;
  } catch (err) {
    console.error(`[scan] NSFW model failed to load, continuing without scores: ${String(err)}`);
    return null;
  }
}

/** Loads (or reports) the model once per process; true when scoring works. */
export function initNsfw(): Promise<boolean> {
  classifierPromise ??= loadClassifier();
  return classifierPromise.then((c) => c != null);
}

/** Probability the image is NSFW, or null when the classifier is unavailable. */
export async function nsfwScore(bytes: Uint8Array): Promise<number | null> {
  const classifier = await (classifierPromise ??= loadClassifier());
  if (!classifier) return null;
  try {
    const image = await RawImage.read(new Blob([bytes]));
    const [top] = await classifier(image);
    if (!top) return null;
    // Two-class model (sfw/nsfw), so the top label determines both.
    return top.label.toLowerCase() === "nsfw" ? top.score : 1 - top.score;
  } catch {
    return null;
  }
}
