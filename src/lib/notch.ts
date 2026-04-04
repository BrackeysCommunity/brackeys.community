export const NOTCH_SIZE = 22;

export const notchClip = `polygon(
  0 0,
  calc(100% - ${NOTCH_SIZE}px) 0,
  100% ${NOTCH_SIZE}px,
  100% 100%,
  ${NOTCH_SIZE}px 100%,
  0 calc(100% - ${NOTCH_SIZE}px)
)`;

export const notchClipInner = `polygon(
  0 0,
  calc(100% - ${NOTCH_SIZE - 2}px) 0,
  100% ${NOTCH_SIZE - 2}px,
  100% 100%,
  ${NOTCH_SIZE - 2}px 100%,
  0 calc(100% - ${NOTCH_SIZE - 2}px)
)`;
