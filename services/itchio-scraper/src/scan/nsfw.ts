import {
  AutoModel,
  AutoProcessor,
  AutoTokenizer,
  env,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type Processor,
  RawImage,
} from "@huggingface/transformers";

/**
 * In-process cover classifier: SigLIP2 zero-shot over category prompts.
 * Policy is Steam-shaped: only sexual content gets gated behind a view
 * button, so only the sexual category can open a flag. Gore is still scored
 * — its prompts stay in the contrast so a gory cover dumps its probability
 * there instead of leaking into the sexual prompts, and the score is kept
 * as evidence — but it never fires on its own.
 *
 * Each category holds a few caption prompts; safe anchors describe what jam
 * covers normally are. The image is scored against every prompt at once and
 * the logits are softmaxed into a contrast: "of these hypotheses, which
 * describes the image?". A category's score is the summed probability of
 * its prompts. The anchor list is calibration-driven — every entry earns its
 * place by killing a measured false-positive class without dropping a real
 * positive below threshold (see the calibration numbers on NSFW_THRESHOLD
 * in config.ts).
 *
 * Model history: AdamCodd/vit-base-nsfw-detector (binary) confidently
 * flagged benign pixel art and missed actual gore; SigLIP1 base couldn't
 * read text covers ("TRUST NO ONE" scored 82% sexual) and its contrast rode
 * noise on minimal art. SigLIP2 fixed both. fp16 on purpose: it matches
 * fp32 within 0.3pp, while q8 collapses real positives below any usable
 * threshold (softmax contrast amplifies quantization noise).
 *
 * The zero-shot pipeline wrapper is NOT used: transformers.js 3.8's
 * pipeline tokenizes SigLIP2 prompts with padding "max_length" but no
 * max_length and crashes, so tokenizer/processor/model are driven directly
 * — which also lets the prompts be tokenized once per process instead of
 * once per cover.
 *
 * Deliberately free of config imports so the Docker build can warm the
 * model cache (warm-nsfw.ts) without a DATABASE_URL. Failure never breaks a
 * scan tick: if the model can't load or a cover can't be classified, the
 * result is null and hashing proceeds — bump DETECTOR_VERSION in scan.ts to
 * re-score once the model is back.
 */

export const NSFW_MODEL = "onnx-community/siglip2-base-patch16-224-ONNX";
export const NSFW_DTYPE = "fp16";

export type NsfwCategory = "sexual" | "gore";

export type NsfwResult = {
  /** The sexual-category score — the only one the threshold compares against. */
  score: number;
  /** All category scores, kept as evidence; gore never flags on its own. */
  categories: Record<NsfwCategory, number>;
  /**
   * The cover's L2-normalized image embedding (768 dims), persisted so
   * prompt/threshold changes re-score from the DB without re-fetching the
   * cover (see scan/embedding.ts). Null only if the ONNX graph ever stops
   * exposing `image_embeds`.
   */
  embedding: Float32Array | null;
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

/**
 * What jam covers normally are — the hypotheses a flag has to beat. Several
 * exist because a THEME is normal jam art even when its subject sounds
 * grim: horror lettering isn't gore, a chalk outline isn't a corpse, a
 * censor bar isn't nudity. Each was added against a measured false
 * positive; don't prune without re-running the calibration set.
 */
const SAFE_PROMPTS = [
  "video game cover art",
  "pixel art from a video game",
  "a cartoon illustration",
  "a screenshot of a video game",
  "a logo or text banner",
  "a landscape painting",
  "a horror game logo with spooky dripping letters",
  "a cartoon drawing of a hand",
  "a minimalist poster with only text on a plain background",
  "a top-down view of a video game level",
  "a chalk outline drawing at a crime scene",
  "a cute cartoon heart",
  "an anatomical diagram of a human heart",
  "a person with a black censor bar over their face",
  // Photographic and painterly covers. Before these, the only "a photo of…"
  // hypotheses in the contrast were the flag prompts themselves, so any
  // photo-styled cover leaked there — face close-ups scored 83–99% sexual,
  // a product shot of a cocktail 79%, and a grayscale drawing of a door 95%.
  // Each measured against real flagged covers at the scanner's 315x250 crop
  // (scores differ sharply from the original image — calibrate on the crop).
  "a close-up photograph of a person's face",
  "a photograph of an old man with long hair and a beard",
  "a photograph of a drink in a glass",
  "a photograph of an everyday object",
  "a drawing of a door in a stone wall",
  "a surreal painting of a woman with long hair",
  "a dark video game menu screen with buttons",
];

const ALL_PROMPTS = [...Object.values(CATEGORY_PROMPTS).flat(), ...SAFE_PROMPTS];

// Bake the weights into the image next to the code; the default cache path
// lives inside node_modules and a cron container would re-download ~400MB
// from HF every tick.
env.cacheDir = new URL("../../.model-cache", import.meta.url).pathname;

type Classifier = {
  model: PreTrainedModel;
  processor: Processor;
  /** ALL_PROMPTS tokenized once — prompts never change within a process. */
  textInputs: ReturnType<PreTrainedTokenizer>;
};

let classifierPromise: Promise<Classifier | null> | null = null;

async function loadClassifier(): Promise<Classifier | null> {
  try {
    const [tokenizer, processor, model] = await Promise.all([
      AutoTokenizer.from_pretrained(NSFW_MODEL),
      AutoProcessor.from_pretrained(NSFW_MODEL),
      AutoModel.from_pretrained(NSFW_MODEL, {
        dtype: NSFW_DTYPE,
        // Cap the ORT thread pool: at 224x224 the default (one thread per
        // visible core) mostly burns CPU on contention — measured ~6.7
        // CPU-seconds per cover versus ~2.8 at 4 threads, for ~230ms more
        // latency. Deliberately constant, not config: this file must load
        // without env (see warm-nsfw.ts).
        session_options: { intraOpNumThreads: 4, interOpNumThreads: 1 },
      }),
    ]);
    const textInputs = tokenizer(ALL_PROMPTS, {
      padding: "max_length",
      max_length: 64,
      truncation: true,
    });
    return { model, processor, textInputs };
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

/** Per-prompt logits (ALL_PROMPTS order) → softmax contrast per category. */
export function contrastCategories(logits: readonly number[]): Record<NsfwCategory, number> {
  const max = Math.max(...logits);
  const exps = logits.map((z) => Math.exp(z - max));
  const total = exps.reduce((a, b) => a + b, 0);
  const probs = new Map(ALL_PROMPTS.map((label, i) => [label, (exps[i] ?? 0) / total]));

  const out = {} as Record<NsfwCategory, number>;
  for (const [category, prompts] of Object.entries(CATEGORY_PROMPTS)) {
    out[category as NsfwCategory] = prompts.reduce((sum, p) => sum + (probs.get(p) ?? 0), 0);
  }
  return out;
}

/** How many prompts contrastCategories expects logits for. */
export const PROMPT_COUNT = ALL_PROMPTS.length;

/** Category scores for a cover, or null when the classifier is unavailable. */
export async function nsfwScore(bytes: Uint8Array): Promise<NsfwResult | null> {
  const classifier = await (classifierPromise ??= loadClassifier());
  if (!classifier) return null;
  try {
    const image = await RawImage.read(new Blob([bytes]));
    const imageInputs = await classifier.processor(image);
    const output = await classifier.model({ ...classifier.textInputs, ...imageInputs });
    const logits = Array.from(output.logits_per_image.data as Float32Array);
    if (logits.length !== PROMPT_COUNT) return null;
    const categories = contrastCategories(logits);
    const embedding = imageEmbedding(output);
    return { score: categories.sexual, categories, embedding };
  } catch {
    return null;
  }
}

/**
 * The graph's pooled image embedding, verified L2-normalized on output (the
 * export normalizes before the logit head; the check guards a future export
 * that doesn't). Missing or misshapen output degrades to null — the score
 * still stands, the entry just can't join a DB-only rescore.
 */
function imageEmbedding(output: Record<string, unknown>): Float32Array | null {
  const embeds = output["image_embeds"] as { data?: unknown; dims?: number[] } | undefined;
  if (!(embeds?.data instanceof Float32Array) || embeds.data.length === 0) return null;
  const vec = embeds.data.slice();
  let sumSq = 0;
  for (const x of vec) sumSq += x * x;
  if (!Number.isFinite(sumSq) || sumSq === 0) return null;
  const norm = Math.sqrt(sumSq);
  if (Math.abs(norm - 1) > 1e-3) {
    for (let i = 0; i < vec.length; i++) vec[i] = (vec[i] ?? 0) / norm;
  }
  return vec;
}
