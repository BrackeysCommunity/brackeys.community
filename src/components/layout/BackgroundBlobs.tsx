import { motion } from "framer-motion";

/**
 * Subtle drifting color blobs that sit behind the dot-field, adding a soft
 * fuchsia/yellow wash to the page. Non-interactive, reduced-motion-aware via
 * framer's defaults.
 */
export function BackgroundBlobs() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden opacity-15"
    >
      {/* Fuchsia blob — upper-left drift */}
      <motion.div
        className="absolute top-[-15%] left-[-10%] h-[55vw] w-[55vw] rounded-full bg-brackeys-fuscia/20 blur-[140px]"
        animate={{
          x: [0, 60, -30, 0],
          y: [0, -40, 30, 0],
        }}
        transition={{
          duration: 38,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      {/* Yellow blob — lower-right drift */}
      <motion.div
        className="absolute top-[45%] right-[-15%] h-[50vw] w-[50vw] rounded-full bg-brackeys-purple/20 blur-[160px]"
        animate={{
          x: [0, -50, 30, 0],
          y: [0, 30, -20, 0],
        }}
        transition={{
          duration: 46,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
    </div>
  );
}
