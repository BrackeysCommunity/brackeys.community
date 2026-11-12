// The game frame's sandbox and permissions: the play and embed pages' iframe
// attributes, and the frame CSP's `sandbox` directive. Import-free, so the
// browser components and the smoke read the same strings the server sends.

/** No `allow-same-origin`, forms, top navigation, modals or downloads: game code is untrusted. */
export const FRAME_SANDBOX =
  "allow-scripts allow-pointer-lock allow-popups allow-popups-to-escape-sandbox";

/** The iframe's `allow`: what a game may ask the browser for. */
export const FRAME_ALLOW = "fullscreen *; gamepad *; autoplay *; screen-wake-lock *";
