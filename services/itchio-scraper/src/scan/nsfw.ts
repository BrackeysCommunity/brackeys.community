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
      AutoModel.from_pretrained(NSFW_MODEL, { dtype: NSFW_DTYPE }),
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
    return { score: categories.sexual, categories };
  } catch {
    return null;
  }
}
