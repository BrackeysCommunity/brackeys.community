import { describe, expect, it } from "vite-plus/test";

import { deployEnvFromOrigin } from "@/lib/deploy-env";

describe("deployEnvFromOrigin", () => {
  it("treats the canonical host and its www form as production", () => {
    expect(deployEnvFromOrigin("https://jams.team")).toBe("production");
    expect(deployEnvFromOrigin("https://www.jams.team")).toBe("production");
    expect(deployEnvFromOrigin("https://JAMS.team/")).toBe("production");
  });

  it("names local origins so a dev server wears LOCAL, not STAGING", () => {
    expect(deployEnvFromOrigin("http://localhost:3000")).toBe("development");
    expect(deployEnvFromOrigin("http://127.0.0.1:3000")).toBe("development");
    expect(deployEnvFromOrigin("http://app.localhost:3000")).toBe("development");
  });

  it("marks every other origin — including a lookalike host — as staging", () => {
    expect(deployEnvFromOrigin("https://staging.jams.team")).toBe("staging");
    expect(deployEnvFromOrigin("https://brackeys-web-staging.up.railway.app")).toBe("staging");
    // The old production host is a redirect now, never a deploy.
    expect(deployEnvFromOrigin("https://brackeys.community")).toBe("staging");
  });

  it("fails loud rather than silent on an unparseable origin", () => {
    expect(deployEnvFromOrigin("not-a-url")).toBe("staging");
  });
});
