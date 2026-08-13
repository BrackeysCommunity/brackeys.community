// The send path is the app's module (relative import into the image, same
// as schema.ts) — one Resend wrapper to keep in sync instead of two. Only
// APP_URL is worker-specific.
export { sendEmail } from "../../../src/lib/email.ts";

export const APP_URL = process.env.APP_URL ?? "https://brackeys.community";
