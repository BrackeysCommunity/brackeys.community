// The send path is the app's module (relative import into the image, same
// as schema.ts) — one Resend wrapper to keep in sync instead of two. Only
// APP_URL is worker-specific, and it comes through the validated config so
// a deploy missing it fails at boot instead of minting production URLs.
import { config } from "./config.ts";

export { sendEmail } from "../../../src/lib/email.ts";

export const APP_URL = config.APP_URL;
