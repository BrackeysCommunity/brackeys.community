import { ChevronDown, ExternalLink } from 'lucide-react';
import { motion } from 'motion/react';
import { LoginButton } from '../auth/LoginButton';
import { DiscordLogo } from '../icons/DiscordLogo';
import { Button } from '../ui/Button';

const HERO_CONTENT = {
  mainHeading: "Learn, Code, and Play —",
  subHeading: "Level Up in Brackeys Community",
  description: "A community for developers of all skill levels to learn, share, and collaborate. Join us today and let's make coding fun!"
};

const BUTTON_CONTENT = {
  github: "View on GitHub",
};

const BackgroundShapes = () => (
  <div className="absolute inset-0 overflow-visible pointer-events-none" aria-hidden="true">
    {/* larger purple blob */}
    <motion.div
      className="absolute top-20 right-[20%] w-72 h-72 rounded-full bg-brackeys-purple-600/15 blur-3xl"
      animate={{
        x: [0, 35, -15, 25, 0],
        y: [0, -25, 30, 10, 0],
        scale: [1, 1.2, 0.9, 1.15, 1],
      }}
      transition={{
        repeat: Infinity,
        duration: 18,
        ease: "easeInOut"
      }}
    />

    {/* purple accent */}
    <motion.div
      className="absolute top-40 right-[30%] w-24 h-24 rounded-full bg-brackeys-purple-400/10 blur-xl"
      animate={{
        x: [0, -25, 25, -10, 0],
        scale: [1, 1.4, 1.1, 1.3, 1],
      }}
      transition={{
        repeat: Infinity,
        duration: 12.5,
        ease: "easeInOut"
      }}
    />

    {/* indigo blob */}
    <motion.div
      className="absolute bottom-32 left-[15%] w-80 h-80 rounded-full bg-indigo-500/15 blur-3xl"
      animate={{
        x: [0, -40, 25, -30, 0],
        y: [0, 35, -25, 20, 0],
        scale: [1, 1.15, 0.85, 1.1, 1],
        rotate: [0, 8, -5, 4, 0]
      }}
      transition={{
        repeat: Infinity,
        duration: 24,
        ease: "easeInOut"
      }}
    />

    {/* indigo accent */}
    <motion.div
      className="absolute bottom-60 left-[25%] w-32 h-32 rounded-full bg-indigo-400/10 blur-2xl"
      animate={{
        y: [0, 40, -20, 25, 0],
        scale: [1, 1.3, 0.85, 1.2, 1],
      }}
      transition={{
        repeat: Infinity,
        duration: 16,
        ease: "easeInOut"
      }}
    />

    {/* yellow square */}
    <motion.div
      className="absolute top-1/2 left-[10%] w-28 h-28 rounded-md rotate-45 bg-brackeys-yellow/20 blur-2xl"
      animate={{
        rotate: [45, 110, 25, 90, 45],
        scale: [1, 1.4, 0.85, 1.3, 1],
        opacity: [0.7, 0.95, 0.5, 0.85, 0.7]
      }}
      transition={{
        repeat: Infinity,
        duration: 20,
        ease: "easeInOut",
      }}
    />

    {/* yellow accent */}
    <motion.div
      className="absolute top-40 left-[40%] w-12 h-12 rounded-md rotate-12 bg-brackeys-yellow/15 blur-xl"
      animate={{
        rotate: [12, 55, -10, 40, 12],
        scale: [1, 1.5, 0.7, 1.3, 1],
      }}
      transition={{
        repeat: Infinity,
        duration: 14,
        ease: "easeInOut",
      }}
    />

    {/* shimmer */}
    {[...Array(12)].map((_, i) => (
      <motion.div
        key={`particle-${i}`}
        className="absolute bg-white rounded-full opacity-80"
        style={{
          width: `${Math.random() * 4 + 1}px`,
          height: `${Math.random() * 4 + 1}px`,
          left: `${Math.random() * 100}%`,
          top: `${Math.random() * 100}%`,
          filter: 'blur(0.5px)',
        }}
        animate={{
          y: [-30, 30],
          x: [-10, 10],
          opacity: [0, 0.8, 0],
          scale: [0.5, 1.2, 0.5],
        }}
        transition={{
          repeat: Infinity,
          duration: Math.random() * 4 + 6,
          delay: Math.random() * 3,
          ease: "easeInOut"
        }}
      />
    ))}
  </div>
);

export const HeroSection = () => (
  <section
    className="w-full flex flex-col items-center justify-center py-24 px-4 sm:px-6 lg:px-8 relative overflow-visible"
    aria-labelledby="hero-heading"
    data-testid="hero-section"
  >
    <BackgroundShapes />

    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="max-w-4xl w-full space-y-8 text-center relative z-10"
    >
      <div>
        <motion.div
          className="mx-auto h-24 w-24 bg-linear-to-br from-brackeys-purple-600 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg"
          whileHover={{ rotate: 5, scale: 1.05 }}
          transition={{ type: 'spring', stiffness: 300 }}
          aria-hidden="true"
        >
          <DiscordLogo className="h-12 w-12 text-white" />
        </motion.div>
        <h1 id="hero-heading" className="mt-8 text-4xl font-extrabold text-white sm:text-5xl lg:text-6xl">
          <span className="block">{HERO_CONTENT.mainHeading}</span>
          <span className="block text-brackeys-purple-600 mt-2">{HERO_CONTENT.subHeading}</span>
        </h1>
        <p className="mt-8 text-xl text-gray-300 max-w-2xl mx-auto">
          {HERO_CONTENT.description}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-center mt-12 w-full mx-auto">
        <LoginButton className="w-full sm:w-auto self-center" />
        <Button
          href="https://github.com/josh-complex/brackeys-web"
          target="_blank"
          variant="secondary"
          size="lg"
          className="w-full sm:w-auto flex items-center gap-2"
          aria-label="View source code on GitHub"
        >
          {BUTTON_CONTENT.github}
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="pt-16 flex justify-center">
        <motion.a
          href="#features"
          className="flex flex-col items-center text-gray-400 hover:text-gray-300 transition-colors"
          animate={{ y: [0, 10, 0] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          aria-label="Scroll to features"
        >
          <span className="text-sm mb-2">Explore Features</span>
          <ChevronDown className="h-6 w-6" />
        </motion.a>
      </div>
    </motion.div>
  </section>
);
