/**
 * Enough UA parsing to label a row in the active-sessions list — "Chrome on
 * macOS", not a device fingerprint. Deliberately not a UA library: the only
 * consumer is a settings pane where a wrong guess costs nothing, and the
 * strings better-auth stores are whatever the client sent.
 */

const BROWSERS: [RegExp, string][] = [
  // Order matters — every Chromium UA also claims Safari, and Edge/Opera
  // both claim Chrome.
  [/\bEdgA?\//, "Edge"],
  [/\bOPR\/|\bOpera\//, "Opera"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bCriOS\//, "Chrome"],
  [/\bChrome\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

const PLATFORMS: [RegExp, string][] = [
  [/\bAndroid\b/, "Android"],
  [/\b(iPhone|iPad|iPod)\b/, "iOS"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bWindows\b/, "Windows"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bLinux\b/, "Linux"],
];

export type DeviceKind = "mobile" | "desktop";

export interface DeviceInfo {
  label: string;
  kind: DeviceKind;
}

function match(patterns: [RegExp, string][], ua: string): string | null {
  for (const [re, name] of patterns) if (re.test(ua)) return name;
  return null;
}

export function describeUserAgent(ua: string | null | undefined): DeviceInfo {
  if (!ua) return { label: "Unknown device", kind: "desktop" };

  const browser = match(BROWSERS, ua);
  const platform = match(PLATFORMS, ua);
  const kind: DeviceKind = /\bMobi\b|\bAndroid\b|\b(iPhone|iPad|iPod)\b/.test(ua)
    ? "mobile"
    : "desktop";

  if (browser && platform) return { label: `${browser} on ${platform}`, kind };
  return { label: browser ?? platform ?? "Unknown device", kind };
}
