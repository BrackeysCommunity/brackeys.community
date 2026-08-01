// Shared-layout close spring: when the detail modal closes, the row or
// card is the *destination* of the morph and framer uses the
// destination's transition — so the snappy spring lives here, not on
// the modal.
export const ROW_CLOSE_TRANSITION = {
  type: "spring" as const,
  stiffness: 520,
  damping: 32,
  mass: 0.7,
};
