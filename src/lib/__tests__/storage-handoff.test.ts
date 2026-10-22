// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  applyHandoff,
  bootStorageHandoff,
  migrateLegacyKeys,
  parseHandoff,
} from "@/lib/storage-handoff";
import { STORAGE_KEYS } from "@/lib/storage-keys";

function encode(payload: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

beforeEach(() => localStorage.clear());

afterEach(() => {
  window.history.replaceState(null, "", "/");
  document.documentElement.removeAttribute("data-theme");
  delete document.documentElement.dataset.reduceMotion;
});

describe("parseHandoff", () => {
  it("maps allowlisted preferences to their new keys", () => {
    const hash = `#handoff=${encode({
      "brackeys-analytics": "off",
      "brackeys-theme": "nord",
      "brackeys-reduce-motion": "reduced",
      "brackeys-muted": "1",
      "brackeys-volume": "0.4",
      "brackeys-censor-profanity": "0",
    })}`;
    expect(parseHandoff(hash)).toEqual({
      [STORAGE_KEYS.analytics]: "off",
      [STORAGE_KEYS.theme]: "nord",
      [STORAGE_KEYS.reduceMotion]: "reduced",
      [STORAGE_KEYS.muted]: "1",
      [STORAGE_KEYS.volume]: "0.4",
      [STORAGE_KEYS.censorProfanity]: "0",
    });
  });

  it("maps the old default theme id", () => {
    expect(parseHandoff(`#handoff=${encode({ "brackeys-theme": "brackeys" })}`)).toEqual({
      [STORAGE_KEYS.theme]: "default",
    });
  });

  it("ignores drafts, unknown keys and values a reader wouldn't accept", () => {
    const hash = `#handoff=${encode({
      "brackeys:forum-composer-draft:v1": '{"title":"secret"}',
      "brackeys-analytics": "maybe",
      "brackeys-volume": "11",
      "brackeys-muted": 1,
      other: "x",
    })}`;
    expect(parseHandoff(hash)).toEqual({});
  });

  it("returns nothing for a missing, malformed or oversized fragment", () => {
    expect(parseHandoff("")).toEqual({});
    expect(parseHandoff("#section")).toEqual({});
    expect(parseHandoff("#handoff=")).toEqual({});
    expect(parseHandoff("#handoff=!!!")).toEqual({});
    expect(parseHandoff(`#handoff=${encode(["off"])}`)).toEqual({});
    expect(parseHandoff(`#handoff=${"a".repeat(5_000)}`)).toEqual({});
  });
});

describe("applyHandoff", () => {
  it("never overwrites a value this origin already has", () => {
    localStorage.setItem(STORAGE_KEYS.analytics, "on");
    const written = applyHandoff(localStorage, {
      [STORAGE_KEYS.analytics]: "off",
      [STORAGE_KEYS.muted]: "1",
    });
    expect(written).toEqual([STORAGE_KEYS.muted]);
    expect(localStorage.getItem(STORAGE_KEYS.analytics)).toBe("on");
    expect(localStorage.getItem(STORAGE_KEYS.muted)).toBe("1");
  });
});

describe("migrateLegacyKeys", () => {
  it("moves old keys to their new names, drafts included, and drops the old ones", () => {
    localStorage.setItem("brackeys-analytics", "off");
    localStorage.setItem("brackeys:forum-composer-draft:v1", '{"title":"t"}');
    localStorage.setItem("brackeys-theme", "brackeys");

    migrateLegacyKeys(localStorage);

    expect(localStorage.getItem(STORAGE_KEYS.analytics)).toBe("off");
    expect(localStorage.getItem(STORAGE_KEYS.forumDraft)).toBe('{"title":"t"}');
    expect(localStorage.getItem(STORAGE_KEYS.theme)).toBe("default");
    expect(localStorage.getItem("brackeys-analytics")).toBeNull();
    expect(localStorage.getItem("brackeys:forum-composer-draft:v1")).toBeNull();
    expect(localStorage.getItem("brackeys-theme")).toBeNull();
  });

  it("keeps a value already stored under the new name", () => {
    localStorage.setItem("brackeys-muted", "1");
    localStorage.setItem(STORAGE_KEYS.muted, "0");
    expect(migrateLegacyKeys(localStorage)).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEYS.muted)).toBe("0");
    expect(localStorage.getItem("brackeys-muted")).toBeNull();
  });
});

describe("bootStorageHandoff", () => {
  it("applies the fragment, reflects it on <html> and strips it from the URL", () => {
    window.history.replaceState(
      { kept: true },
      "",
      `/jams?view=list#handoff=${encode({
        "brackeys-theme": "dracula",
        "brackeys-reduce-motion": "1",
      })}`,
    );

    bootStorageHandoff();

    expect(localStorage.getItem(STORAGE_KEYS.theme)).toBe("dracula");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dracula");
    expect(document.documentElement.dataset.reduceMotion).toBe("true");
    expect(window.location.pathname + window.location.search).toBe("/jams?view=list");
    expect(window.location.hash).toBe("");
    expect(window.history.state).toEqual({ kept: true });
  });

  it("leaves an ordinary fragment alone", () => {
    window.history.replaceState(null, "", "/rules#conduct");
    bootStorageHandoff();
    expect(window.location.hash).toBe("#conduct");
  });
});
