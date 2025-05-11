import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';

type SplashScreenProps = {
  onComplete: () => void;
};

export const SplashScreen = ({ onComplete }: SplashScreenProps) => {
  const [animationComplete, setAnimationComplete] = useState(false);
  const [shadowAnimationComplete, setShadowAnimationComplete] = useState(false);
  const [gradientAnimationComplete, setGradientAnimationComplete] = useState(false);
  const [startInitialAnimation, setStartInitialAnimation] = useState(false);

  useEffect(() => {
    const startTimer = setTimeout(() => {
      setStartInitialAnimation(true);
    }, 500);

    const failsafeTimer = setTimeout(() => {
      if (!animationComplete) {
        setAnimationComplete(true);
        onComplete();
      }
    }, 4000);

    return () => {
      clearTimeout(startTimer);
      clearTimeout(failsafeTimer);
    };
  }, [animationComplete, onComplete]);

  const handleAnimationComplete = () => {
    localStorage.setItem('splash-screen-complete', 'true');
    setAnimationComplete(true);
    onComplete();
  };

  return (
    <AnimatePresence>
      {!animationComplete && (
        <div className="fixed size-full inset-0 flex items-center justify-center">
          {startInitialAnimation && (
            <motion.img
              src="/svg/brackeys-logo.svg"
              alt="Brackeys Logo"
              className="size-64 text-background rounded-xl"
              initial={{
                opacity: 0,
                filter: "drop-shadow(0 0 0 rgba(0,0,0,0.5))"
              }}
              animate={{
                opacity: !gradientAnimationComplete ? 1 : [1, 0, 0],
                filter: !gradientAnimationComplete
                  ? ["drop-shadow(0 0 0 rgba(0,0,0,0.5))",
                    "drop-shadow(0 0 14px rgba(0,0,0,1))",
                    "drop-shadow(0 0 10px rgba(0,0,0,0.8))"]
                  : ["drop-shadow(0 0 10px rgba(0,0,0,0.8))",
                    "drop-shadow(0 0 0 rgba(0,0,0,0.5))",
                    "drop-shadow(0 0 0 rgba(0,0,0,0.5))"]
              }}
              transition={{
                duration: !gradientAnimationComplete ? .8 : 1.8,
                opacity: { duration: !gradientAnimationComplete ? .8 : 1.8 },
                filter: {
                  duration: !gradientAnimationComplete ? .8 : 1.8,
                  times: !gradientAnimationComplete ? [0, 0.7, 1] : [0, .3, 1],
                  ease: "easeInOut"
                }
              }}
              onAnimationComplete={() => {
                if (!gradientAnimationComplete) {
                  setShadowAnimationComplete(true);
                } else {
                  handleAnimationComplete();
                }
              }}
            />
          )}
          <div className="absolute size-full inset-0 flex items-center justify-center">
            {shadowAnimationComplete && !gradientAnimationComplete && (
              <motion.div
                className="size-64 mask-[url(/svg/brackeys-logo.svg)]"
                initial={{
                  backgroundImage: "linear-gradient(to bottom, transparent, transparent, var(--color-brackeys-yellow), var(--color-brackeys-fuscia), var(--color-brackeys-purple), transparent, transparent)",
                  backgroundPosition: "0 0%",
                  backgroundSize: "100% 700%"
                }}
                animate={{
                  backgroundPosition: ["0 0%", "0 100%"]
                }}
                transition={{
                  duration: 1.5,
                  ease: "easeInOut"
                }}
                onAnimationComplete={() => {
                  setGradientAnimationComplete(true);
                }}
              />
            )}
          </div>
        </div>
      )}
    </AnimatePresence>
  );
};
