/**
 * The `camera-target` behavior's schema: data only. With no camera target
 * from the game, the shell follows the weighted centre of the entities
 * carrying it.
 */
import { z } from "zod";

import { defineBehavior } from "../behaviors";
import { seatField } from "./player-input";

const cameraTargetFields = {
  weight: z
    .number()
    .positive()
    .default(1)
    .describe(
      "Its pull on the camera beside the other targets: twice the weight, twice the pull. Default 1.",
    )
    .meta({ title: "Weight", group: "camera" }),
  seat: seatField(
    "The seat whose view follows it, for split screens; omitted, every view does.",
  ).optional(),
};

/** A `camera-target` block as an entity carries it, defaults applied. */
export type CameraTargetBlock = z.infer<z.ZodObject<typeof cameraTargetFields>>;

export const CAMERA_TARGET = defineBehavior({
  name: "camera-target",
  description:
    "Marks what the camera follows when the game names no target: the weighted centre of every entity carrying it.",
  fields: cameraTargetFields,
  inspector: { label: "Camera target", order: ["weight", "seat"] },
});
