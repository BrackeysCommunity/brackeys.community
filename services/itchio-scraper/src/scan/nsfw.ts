import { env, pipeline, RawImage } from "@huggingface/transformers";

/**
 * In-process cover classifier: SigLIP zero-shot over category prompts, so a
 * flag says WHY it fired — "gore" is a different judgment call than
 * "sexual", and the queue shows the mod which one this is.
 *
 * Each category holds a few caption prompts; safe anchors describe what jam
 * covers normally are. The image is scored against every prompt at once and
 * the sigmoid outputs are re-normalized into a softmax contrast: "of these
 * hypotheses, which describes the image?". A category's score is the summed
 * probability of its prompts. This contrast step is what makes the scores
 * usable — raw SigLIP sigmoids sit near zero for everything, while the
 * previous binary ViT (AdamCodd/vit-base-nsfw-detector) confidently flagged
 * benign pixel art and missed actual gore.
 *
 * fp16 on purpose: it scores within 0.3pp of fp32 on our calibration set,
 * while q8 collapses real positives below any usable threshold (softmax
 * contrast amplifies quantization noise).
 *
 * Deliberately free of config imports so the Docker build can warm the
 * model cache (warm-nsfw.ts) without a DATABASE_URL. Failure never breaks a
 * scan tick: if the model can't load or a cover can't be classified, the
 * result is null and hashing proceeds — bump DETECTOR_VERSION in scan.ts to
 * re-score once the model is back.
 */

export const NSFW_MODEL = "Xenova/siglip-base-patch16-224";
export const NSFW_DTYPE = "fp16";

export type NsfwCategory = "sexual" | "gore";

export type NsfwResult = {
  /** The highest category score — what the threshold compares against. */
  score: number;
  /** The category that produced it — the human-readable reason. */
  reason: NsfwCategory;
  /** All category scores, kept as evidence. */
  categories: Record<NsfwCategory, number>;
};

const CATEGORY_PROMPTS: Record<NsfwCategory, string[]> = {
  sexual: [
    "a photo of a naked person",
    "an image showing explicit nudity or sexual content",
    "erotic artwork of a nude figure",
  ],
  gore: [
    "a photo of a dead body covered in blood",
    "an image showing graphic gore, blood, and mutilation",
    "artwork of a corpse or severed body parts",
  ],
};

/** What jam covers normally are — the hypotheses a flag has to beat. */
const SAFE_PROMPTS = [
  "video game cover art",
  "pixel art from a video game",
  "a cartoon illustration",
  "a screenshot of a video game",
  "a logo or text banner",
  "a landscape painting",
];

const ALL_PROMPTS = [...Object.values(CATEGORY_PROMPTS).flat(), ...SAFE_PROMPTS];

// Bake the weights into the image next to the code; the default cache path
// lives inside node_modules and a cron container would re-download ~400MB
// from HF every tick.
env.cacheDir = new URL("../../.model-cache", import.meta.url).pathname;

type Classifier = (
  image: RawImage,
  labels: string[],
) => Promise<Array<{ label: string; score: number }>>;

let classifierPromise: Promise<Classifier | null> | null = null;

async function loadClassifier(): Promise<Classifier | null> {
  try {
    const pipe = await pipeline("zero-shot-image-classification", NSFW_MODEL, {
      dtype: NSFW_DTYPE,
    });
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

/** SigLIP sigmoid probabilities → softmax contrast across all prompts. */
export function contrastCategories(
  scored: ReadonlyArray<{ label: string; score: number }>,
): Record<NsfwCategory, number> {
  const logits = scored.map(({ score }) => {
    const p = Math.min(Math.max(score, 1e-9), 1 - 1e-9);
    return Math.log(p / (1 - p));
  });
  const max = Math.max(...logits);
  const exps = logits.map((z) => Math.exp(z - max));
  const total = exps.reduce((a, b) => a + b, 0);
  const probs = new Map(scored.map(({ label }, i) => [label, (exps[i] ?? 0) / total]));

  const out = {} as Record<NsfwCategory, number>;
  for (const [category, prompts] of Object.entries(CATEGORY_PROMPTS)) {
    out[category as NsfwCategory] = prompts.reduce((sum, p) => sum + (probs.get(p) ?? 0), 0);
  }
  return out;
}

/** Category scores for a cover, or null when the classifier is unavailable. */
export async function nsfwScore(bytes: Uint8Array): Promise<NsfwResult | null> {
  const classifier = await (classifierPromise ??= loadClassifier());
  if (!classifier) return null;
  try {
    const image = await RawImage.read(new Blob([bytes]));
    const scored = await classifier(image, ALL_PROMPTS);
    if (scored.length === 0) return null;
    const categories = contrastCategories(scored);
    const [reason, score] = (Object.entries(categories) as Array<[NsfwCategory, number]>).reduce(
      (best, next) => (next[1] > best[1] ? next : best),
    );
    return { score, reason, categories };
  } catch {
    return null;
  }
}
