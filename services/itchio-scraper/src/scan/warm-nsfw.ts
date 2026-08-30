import { initNsfw, NSFW_MODEL } from "./nsfw.ts";

// Docker build step: download the model into .model-cache so cron containers
// start with the weights already in the image. Fails the build loudly rather
// than shipping an image that silently scans without NSFW scores.
const ok = await initNsfw();
if (!ok) {
  console.error(`[warm-nsfw] failed to fetch ${NSFW_MODEL}`);
  process.exit(1);
}
console.log(`[warm-nsfw] ${NSFW_MODEL} cached`);
