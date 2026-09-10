import { describe, expect, it } from "vite-plus/test";

import { CURRENCIES, currencyOptionLabel, currencySymbol, normalizeCurrency } from "../currency";

describe("normalizeCurrency", () => {
  it("reads anything it doesn't recognise as USD", () => {
    // Rows written before the column existed are unlabelled, and every one
    // of them was rendered with a hardcoded `$` — so USD is what they said.
    expect(normalizeCurrency(null)).toBe("USD");
    expect(normalizeCurrency("")).toBe("USD");
    expect(normalizeCurrency("XYZ")).toBe("USD");
  });

  it("accepts a stored code case-insensitively", () => {
    expect(normalizeCurrency("eur")).toBe("EUR");
    expect(normalizeCurrency(" GBP ")).toBe("GBP");
  });
});

describe("currencySymbol", () => {
  it("gives a glyph where one is unambiguous and the code where it isn't", () => {
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("EUR")).toBe("€");
    // Three of the listed currencies use "kr"; the code is the only
    // spelling that tells them apart.
    expect(currencySymbol("SEK")).toBe("SEK ");
    expect(currencySymbol("DKK")).toBe("DKK ");
    expect(currencySymbol("NOK")).toBe("NOK ");
  });
});

describe("currencyOptionLabel", () => {
  it("names the code, and the glyph only when it adds something", () => {
    expect(currencyOptionLabel("USD")).toBe("USD — $");
    expect(currencyOptionLabel("SEK")).toBe("SEK");
  });

  it("labels every currency in the list", () => {
    for (const code of CURRENCIES) {
      expect(currencyOptionLabel(code)).toContain(code);
    }
  });
});
