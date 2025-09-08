import { ChevronDown } from 'lucide-react';
import { motion } from 'motion/react';
import { ComponentType } from 'react';
import { Link } from '@tanstack/react-router';
import { cn } from '../../lib/utils';

export const CommandShapes = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
    <motion.div
      className="absolute bottom-10 right-10 w-32 h-32 rounded-md bg-brackeys-yellow/10 rotate-45"
      animate={{
        rotate: [45, 55, 45],
        scale: [1, 1.05, 1],
      }}
      transition={{
        repeat: Infinity,
        duration: 8,
        ease: 'easeInOut',
      }}
    />
  </div>
);

export const EventShapes = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
    <motion.div
      className="absolute top-20 right-20 w-24 h-24 rounded-full border-4 border-brackeys-fuscia/20"
      animate={{
        scale: [1, 1.2, 0.9, 1.3, 1],
        borderWidth: ['4px', '2px', '5px', '1px', '4px'],
        x: [0, 80, -60, 40, 0],
        y: [0, -50, 70, -30, 0],
      }}
      transition={{
        repeat: Infinity,
        duration: 20,
        ease: 'easeInOut',
      }}
    />
    <motion.div
      className="absolute bottom-20 left-10 w-16 h-16 rounded-full border-2 border-brackeys-fuscia/15"
      animate={{
        scale: [1, 1.3, 0.8, 1.1, 1],
        x: [0, 120, -80, 50, 0],
        y: [0, 60, 100, -70, 0],
      }}
      transition={{
        repeat: Infinity,
        duration: 25,
        ease: 'easeInOut',
      }}
    />
    <motion.div
      className="absolute top-1/2 left-1/3 w-6 h-6 rounded-full bg-brackeys-fuscia/10"
      animate={{
        scale: [1, 1.5, 0.7, 1.2, 1],
        opacity: [0.4, 0.7, 0.3, 0.6, 0.4],
        x: [0, -100, 120, -60, 0],
        y: [0, 80, -90, 40, 0],
        rotate: [0, 90, -60, 45, 0],
      }}
      transition={{
        repeat: Infinity,
        duration: 18,
        ease: 'easeInOut',
      }}
    />
  </div>
);

export const AnnouncementShapes = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
    <motion.div
      className="absolute top-20 left-20 w-32 h-4 rounded-full bg-brackeys-purple/10"
      animate={{
        width: ['8rem', '12rem', '8rem'],
        opacity: [0.5, 0.8, 0.5],
      }}
      transition={{
        repeat: Infinity,
        duration: 5,
        ease: 'easeInOut',
      }}
    />
    <motion.div
      className="absolute top-32 left-28 w-24 h-4 rounded-full bg-brackeys-purple/10"
      animate={{
        width: ['6rem', '10rem', '6rem'],
        opacity: [0.4, 0.7, 0.4],
      }}
      transition={{
        repeat: Infinity,
        duration: 5.5,
        ease: 'easeInOut',
        delay: 0.5,
      }}
    />
  </div>
);

const shapeComponents = [CommandShapes, EventShapes, AnnouncementShapes];

export type FeatureSectionItem = {
  id: string;
  title: string;
  description: string;
  longDescription?: string;
  icon: ComponentType<{ className?: string }>;
  colorClass: string;
};

type FeatureSectionProps = {
  feature: FeatureSectionItem;
  index: number;
};

export const FeatureSection = ({ feature, index }: FeatureSectionProps) => {
  const ShapeComponent = shapeComponents[index % shapeComponents.length];
  const isEven = index % 2 === 0;

  return (
    <section
      className={cn(
        'w-full py-24 px-4 sm:px-6 lg:px-8 relative overflow-hidden rounded-lg',
        isEven ? 'bg-gray-900' : 'bg-gray-800/30 border border-gray-700 shadow-md'
      )}
      aria-labelledby={`heading-${feature.id}`}
      data-testid={`feature-section-${feature.id}`}
    >
      <ShapeComponent />

      <div className="max-w-7xl mx-auto relative z-10">
        <div
          className={cn(
            'grid gap-12 items-center',
            isEven ? 'md:grid-cols-2' : 'md:grid-cols-2 md:grid-flow-dense'
          )}
        >
          <motion.div
            className={!isEven ? 'md:col-start-2' : ''}
            initial={{ opacity: 0, x: isEven ? -20 : 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true, margin: '-100px' }}
          >
            <div className="flex flex-col items-start text-left">
              <h2 id={`heading-${feature.id}`} className="text-3xl font-bold text-white mb-4">
                {feature.title}
              </h2>
              <p className="text-xl text-gray-300 mb-4">{feature.description}</p>
              <p className="text-gray-400">{feature.longDescription}</p>
              <Link
                to="/dashboard"
                className={cn(
                  'mt-8 inline-flex items-center gap-2 text-base font-medium transition-colors',
                  feature.colorClass
                )}
                aria-label={`Learn more about ${feature.title.toLowerCase()}`}
              >
                Learn more
                <motion.div
                  animate={{ x: [0, 5, 0] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                >
                  <ChevronDown className="h-4 w-4 -rotate-90" aria-hidden="true" />
                </motion.div>
              </Link>
            </div>
          </motion.div>

          <motion.div
            className={cn(
              'rounded-xl overflow-hidden border shadow-lg relative',
              !isEven && 'md:col-start-1',
              isEven ? 'border-gray-700 bg-gray-800/50' : 'border-gray-700 bg-gray-900/50'
            )}
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            viewport={{ once: true, margin: '-100px' }}
          >
            <div className="aspect-w-16 aspect-h-9 w-full">
              <div className={cn('w-full h-full flex items-center justify-center p-8 relative')}>
                <motion.div
                  animate={
                    index === 0
                      ? { y: [0, -10, 0] }
                      : index === 1
                        ? { rotate: [0, 10, 0] }
                        : { scale: [1, 1.1, 1] }
                  }
                  transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
                >
                  <feature.icon
                    className={cn('h-24 w-24', feature.colorClass)}
                    aria-hidden="true"
                  />
                </motion.div>

                {index === 0 && (
                  <>
                    <motion.div
                      className="absolute top-10 left-10 w-12 h-2 rounded-full bg-brackeys-yellow/30"
                      animate={{ width: ['3rem', '5rem', '3rem'] }}
                      transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
                    />
                    <motion.div
                      className="absolute bottom-10 right-10 w-12 h-2 rounded-full bg-brackeys-yellow/30"
                      animate={{ width: ['3rem', '7rem', '3rem'] }}
                      transition={{
                        repeat: Infinity,
                        duration: 3.5,
                        ease: 'easeInOut',
                        delay: 0.5,
                      }}
                    />
                  </>
                )}

                {index === 1 && (
                  <>
                    <motion.div
                      className="absolute top-1/4 left-1/4 w-16 h-16 rounded-full border-2 border-brackeys-fuscia/30"
                      animate={{ scale: [1, 1.3, 1] }}
                      transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
                    />
                    <motion.div
                      className="absolute bottom-1/4 right-1/4 w-8 h-8 rounded-full border border-brackeys-fuscia/20"
                      animate={{ scale: [1, 1.5, 1] }}
                      transition={{ repeat: Infinity, duration: 3.5, ease: 'easeInOut', delay: 1 }}
                    />
                  </>
                )}

                {index === 2 && (
                  <>
                    <motion.div
                      className="absolute top-1/3 left-1/5 w-20 h-3 rounded-full bg-brackeys-purple/20"
                      animate={{ width: ['5rem', '8rem', '5rem'], opacity: [0.2, 0.4, 0.2] }}
                      transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
                    />
                    <motion.div
                      className="absolute top-1/2 left-1/4 w-16 h-3 rounded-full bg-brackeys-purple/20"
                      animate={{ width: ['4rem', '7rem', '4rem'], opacity: [0.15, 0.35, 0.15] }}
                      transition={{
                        repeat: Infinity,
                        duration: 4.5,
                        ease: 'easeInOut',
                        delay: 0.5,
                      }}
                    />
                    <motion.div
                      className="absolute bottom-1/3 right-1/5 w-24 h-3 rounded-full bg-brackeys-purple/20"
                      animate={{ width: ['6rem', '10rem', '6rem'], opacity: [0.25, 0.45, 0.25] }}
                      transition={{ repeat: Infinity, duration: 5, ease: 'easeInOut', delay: 1 }}
                    />
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};
