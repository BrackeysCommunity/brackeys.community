import { describe, expect, it } from "vite-plus/test";

import { isRecruiting, isRecruitingWithoutPosts } from "../team-recruiting";

describe("isRecruiting", () => {
  it("shows the badge when the flag is set and a post is open", () => {
    expect(isRecruiting({ recruiting: true, openPostCount: 1 })).toBe(true);
  });

  // Cookie's finding: a badge promising a door the page doesn't have.
  it("hides the badge when the flag is set but nothing is posted", () => {
    expect(isRecruiting({ recruiting: true, openPostCount: 0 })).toBe(false);
  });

  // The posts are the door, but the flag is still the owner's say-so: a team
  // with an open post that has turned recruiting off is not advertising.
  it("hides the badge when posts are open but the flag is off", () => {
    expect(isRecruiting({ recruiting: false, openPostCount: 3 })).toBe(false);
  });

  it("treats a null flag as off", () => {
    expect(isRecruiting({ recruiting: null, openPostCount: 2 })).toBe(false);
  });
});

describe("isRecruitingWithoutPosts", () => {
  it("nudges the owner who set the flag and posted nothing", () => {
    expect(isRecruitingWithoutPosts({ recruiting: true, openPostCount: 0 })).toBe(true);
  });

  it("stays quiet once something is posted", () => {
    expect(isRecruitingWithoutPosts({ recruiting: true, openPostCount: 1 })).toBe(false);
  });

  it("stays quiet when the flag was never set", () => {
    expect(isRecruitingWithoutPosts({ recruiting: false, openPostCount: 0 })).toBe(false);
  });
});

// The two are exclusive by construction: every flagged team is either
// advertising or being nudged, never both and never neither.
describe("the two halves of the rule", () => {
  it("splits flagged teams cleanly", () => {
    for (const openPostCount of [0, 1, 5]) {
      const team = { recruiting: true, openPostCount };
      expect(isRecruiting(team)).toBe(!isRecruitingWithoutPosts(team));
    }
  });
});
