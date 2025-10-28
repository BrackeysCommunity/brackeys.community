import { Link } from '@tanstack/react-router';
import { Home, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect } from 'react';

export function CollaborationHub() {
  useEffect(() => {
    document.title = 'Collaboration Hub - Brackeys Community';
  }, []);

  return (
    <div className="container mx-auto px-4 py-16 flex items-center justify-center min-h-[80vh]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center max-w-2xl"
      >
        {/* Cute illustration */}
        <motion.div
          animate={{
            y: [0, -10, 0],
          }}
          transition={{
            duration: 2,
            repeat: Number.POSITIVE_INFINITY,
            ease: 'easeInOut',
          }}
          className="mb-8"
        >
          <svg
            viewBox="0 0 200 200"
            className="w-48 h-48 mx-auto"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>Collaboration Hub</title>
            {/* Cute robot/character - with head tilt */}
            <motion.g
              animate={{
                rotate: [0, 0, 0, 0, 0, 0, 0, 12, 12, 0],
              }}
              transition={{
                duration: 4.5,
                repeat: Number.POSITIVE_INFINITY,
                ease: 'easeInOut',
                times: [0, 0.6, 0.65, 0.7, 0.75, 0.8, 0.82, 0.84, 0.88, 1],
              }}
              style={{ originX: '100px', originY: '95px' }}
            >
              <circle cx="100" cy="100" r="60" fill="#6366f1" opacity="0.2" />
              <circle cx="100" cy="95" r="45" fill="#818cf8" />
              {/* Left eye - normal */}
              <circle cx="85" cy="90" r="6" fill="#1e293b" />
              {/* Right eye - winks */}
              <motion.circle
                cx="115"
                cy="90"
                r="6"
                fill="#1e293b"
                animate={{
                  scaleY: [1, 1, 1, 1, 1, 1, 1, 0.1, 0.1, 1],
                }}
                transition={{
                  duration: 4.5,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: 'easeInOut',
                  times: [0, 0.6, 0.65, 0.7, 0.75, 0.8, 0.82, 0.84, 0.88, 1],
                }}
              />
              {/* Smile */}
              <path
                d="M 80 105 Q 100 115 120 105"
                stroke="#1e293b"
                strokeWidth="4"
                strokeLinecap="round"
                fill="none"
              />
              {/* Antennae */}
              <line
                x1="100"
                y1="50"
                x2="100"
                y2="20"
                stroke="#818cf8"
                strokeWidth="3"
              />
              <motion.circle
                cx="100"
                cy="15"
                r="5"
                fill="#fbbf24"
                animate={{
                  opacity: [1, 0.3, 1],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: 'easeInOut',
                }}
              />
            </motion.g>
          </svg>
        </motion.div>

        {/* Message */}
        <motion.h1
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-4xl md:text-5xl font-bold text-white mb-4"
        >
          Nothing to See Here... Yet!
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-xl text-gray-300 mb-8"
        >
          The Collaboration Hub is currently under construction. We're building
          something awesome for you!
        </motion.p>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex flex-col sm:flex-row gap-4 justify-center items-center"
        >
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-brackeys-purple-600 hover:bg-brackeys-purple-700 text-white rounded-lg font-medium transition-colors"
          >
            <Home className="h-5 w-5" />
            Back to Home
          </Link>

          <Link
            to="/collaborations"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
          >
            <Sparkles className="h-5 w-5" />
            Browse Collaborations
          </Link>
        </motion.div>
      </motion.div>
    </div>
  );
}
