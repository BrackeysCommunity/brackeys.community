import { describe, expect, it } from "vite-plus/test";

import { SAVE_VERSION } from "../../game/save-file";
import { INPUT_SCRIPT_VERSION } from "../../scene/input-script";
import { RECORDING_VERSION } from "../../scene/recording-schema";
import { SCENE_FORMAT_VERSION } from "../../scene/types";
import { COLLAB_LAYOUT_VERSION } from "../../version";
import { ENGINE_FORMATS, releaseJsonSchema } from "../release";

describe("ENGINE_FORMATS", () => {
  it("is every format version this engine writes, frozen", () => {
    expect(ENGINE_FORMATS).toEqual({
      scene: SCENE_FORMAT_VERSION,
      prefab: SCENE_FORMAT_VERSION,
      recording: RECORDING_VERSION,
      inputScript: INPUT_SCRIPT_VERSION,
      save: SAVE_VERSION,
      collabLayout: COLLAB_LAYOUT_VERSION,
    });
    expect(Object.isFrozen(ENGINE_FORMATS)).toBe(true);
  });

  it("names exactly the formats a manifest's engine block records", () => {
    const schema = releaseJsonSchema() as {
      properties: {
        engine: { properties: { formats: { properties: Record<string, unknown> } } };
      };
    };
    expect(Object.keys(ENGINE_FORMATS).sort()).toEqual(
      Object.keys(schema.properties.engine.properties.formats.properties).sort(),
    );
  });
});
