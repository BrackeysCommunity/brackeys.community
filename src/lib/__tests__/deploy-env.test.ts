import { describe, expect, it } from "vite-plus/test";

import { deployEnvFromOrigin } from "@/lib/deploy-env";

describe("deployEnvFromOrigin", () => {
  it("treats the canonical host and its www form as production", () => {
    expect(deployEnvFromOrigin("https://brackeys.community")).toBe("production");
    expect(deployEnvFromOrigin("https://www.brackeys.community")).toBe("production");
    expect(deployEnvFromOrigin("https://BRACKEYS.community/")).toBe("production");
  });

  it("names local origins so a dev server wears LOCAL, not STAGING", () => {
    expect(deployEnvFromOrigin("http://localhost:3000")).toBe("development");
    expect(deployEnvFromOrigin("http://127.0.0.1:3000")).toBe("development");
    expect(deployEnvFromOrigin("http://app.localhost:3000")).toBe("development");
  });

  it("marks every other origin — including a lookalike host — as staging", () => {
    expect(deployEnvFromOrigin("https://staging.brackeys.dev")).toBe("staging");
    expect(deployEnvFromOrigin("https://brackeys-web-staging.up.railway.app")).toBe("staging");
    // Not a subdomain match: `staging.brackeys.community` is still staging.
    expect(deployEnvFromOrigin("https://staging.brackeys.community")).toBe("staging");
  });

  it("fails loud rather than silent on an unparseable origin", () => {
    expect(deployEnvFromOrigin("not-a-url")).toBe("staging");
  });
});
