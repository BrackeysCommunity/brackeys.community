import { motion } from 'motion/react';
import { Button } from '../ui';

const BUTTON_CONTENT = {
  exploreCommunity: "Explore Community"
};

const CtaBackgroundAnimation = () => {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {/* first wave */}
      <svg
        className="absolute inset-0 w-full h-full opacity-20"
        viewBox="0 0 1200 600"
        preserveAspectRatio="none"
      >
        <motion.path
          d="M0,100 C300,180 500,0 1200,100 L1200,600 L0,600 Z"
          fill="url(#ctaGradient1)"
          animate={{
            d: [
              "M0,100 C300,180 500,0 1200,100 L1200,600 L0,600 Z",
              "M0,150 C400,20 800,200 1200,80 L1200,600 L0,600 Z",
              "M0,100 C300,180 500,0 1200,100 L1200,600 L0,600 Z"
            ]
          }}
          transition={{
            repeat: Infinity,
            duration: 20,
            ease: "easeInOut"
          }}
        />
        <defs>
          <linearGradient id="ctaGradient1" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#6b38e0" />
            <stop offset="50%" stopColor="#8c63f3" />
            <stop offset="100%" stopColor="#4c2cd1" />
          </linearGradient>
        </defs>
      </svg>

      {/* second wave */}
      <svg
        className="absolute inset-0 w-full h-full opacity-20"
        viewBox="0 0 1200 600"
        preserveAspectRatio="none"
      >
        <motion.path
          d="M0,50 C250,150 700,0 1200,80 L1200,600 L0,600 Z"
          fill="url(#ctaGradient2)"
          animate={{
            d: [
              "M0,50 C250,150 700,0 1200,80 L1200,600 L0,600 Z",
              "M0,120 C500,-50 900,200 1200,30 L1200,600 L0,600 Z",
              "M0,50 C250,150 700,0 1200,80 L1200,600 L0,600 Z"
            ]
          }}
          transition={{
            repeat: Infinity,
            duration: 15,
            ease: "easeInOut"
          }}
        />
        <defs>
          <linearGradient id="ctaGradient2" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#7c4dff" />
            <stop offset="50%" stopColor="#9c7aff" />
            <stop offset="100%" stopColor="#5d3ccc" />
          </linearGradient>
        </defs>
      </svg>

      {/* third wave */}
      <svg
        className="absolute inset-0 w-full h-full opacity-15"
        viewBox="0 0 1200 600"
        preserveAspectRatio="none"
      >
        <motion.path
          d="M0,20 C350,180 650,-50 1200,20 L1200,600 L0,600 Z"
          fill="url(#ctaGradient3)"
          animate={{
            d: [
              "M0,20 C350,180 650,-50 1200,20 L1200,600 L0,600 Z",
              "M0,80 C200,-100 800,220 1200,0 L1200,600 L0,600 Z",
              "M0,20 C350,180 650,-50 1200,20 L1200,600 L0,600 Z"
            ]
          }}
          transition={{
            repeat: Infinity,
            duration: 12,
            ease: "easeInOut"
          }}
        />
        <defs>
          <linearGradient id="ctaGradient3" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#6c37e3" />
            <stop offset="50%" stopColor="#8d5bf7" />
            <stop offset="100%" stopColor="#4932ba" />
          </linearGradient>
        </defs>
      </svg>

      {/* radial background glow */}
      <div
        className="absolute inset-0 bg-gradient-radial from-brackeys-purple-500/5 via-transparent to-transparent"
        style={{ mixBlendMode: 'soft-light' }}
      />

      {/* small particles */}
      {[...Array(12)].map((_, i) => (
        <motion.div
          key={`particle-${i}`}
          className="absolute bg-white rounded-full opacity-0"
          style={{
            width: `${Math.random() * 4 + 1}px`,
            height: `${Math.random() * 4 + 1}px`,
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            filter: 'blur(0.5px)',
            boxShadow: '0 0 3px 1px rgba(255, 255, 255, 0.3)'
          }}
          animate={{
            y: [0, -20, 0],
            opacity: [0, i % 3 === 0 ? 0.7 : 0.4, 0],
            scale: [1, 1.2, 1]
          }}
          transition={{
            repeat: Infinity,
            duration: Math.random() * 5 + 5,
            delay: Math.random() * 8,
            ease: "easeInOut"
          }}
        />
      ))}

      {/* larger particles */}
      {[...Array(3)].map((_, i) => (
        <motion.div
          key={`large-particle-${i}`}
          className="absolute rounded-full opacity-0"
          style={{
            width: `${Math.random() * 6 + 4}px`,
            height: `${Math.random() * 6 + 4}px`,
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            backgroundColor: i === 0 ? '#a78bfa' : i === 1 ? '#93c5fd' : '#fde68a',
            filter: 'blur(1px)',
            boxShadow: i === 0 ? '0 0 6px 2px rgba(167, 139, 250, 0.3)' :
              i === 1 ? '0 0 6px 2px rgba(147, 197, 253, 0.3)' :
                '0 0 6px 2px rgba(253, 230, 138, 0.3)'
          }}
          animate={{
            y: [0, -30, 0],
            x: [0, i % 2 === 0 ? 15 : -15, 0],
            opacity: [0, 0.5, 0],
            scale: [1, 1.3, 1]
          }}
          transition={{
            repeat: Infinity,
            duration: 12 + i * 4,
            delay: i * 3,
            ease: "easeInOut"
          }}
        />
      ))}
    </div>
  );
};

export const CtaSection = () => {
  return (
    <section
      className="w-full pt-24 pb-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-brackeys-purple-900/30 to-indigo-900/30 relative overflow-hidden rounded-lg border border-brackeys-purple-500 shadow-brackeys-purple"
      aria-labelledby="cta-heading"
      data-testid="cta-section"
    >
      <CtaBackgroundAnimation />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        viewport={{ once: true, margin: "-100px" }}
        className="max-w-4xl w-full mx-auto text-center space-y-8 relative z-10"
      >
        <h2
          id="cta-heading"
          className="text-3xl font-bold text-white"
        >
          Ready to join our developer community?
        </h2>
        <p className="text-xl text-gray-300 max-w-2xl mx-auto">
          Connect with thousands of developers, share your projects, and level up your skills today.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center mt-12 w-full max-w-md mx-auto">
          <Button
            to="/login"
            variant="primary"
            size="lg"
            className="w-full sm:w-auto shadow-lg"
            aria-label="Explore our community"
            data-testid="cta-explore-button"
          >
            {BUTTON_CONTENT.exploreCommunity}
          </Button>
        </div>
      </motion.div>
    </section>
  );
};
