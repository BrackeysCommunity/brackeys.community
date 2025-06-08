import { motion } from 'framer-motion';
import { Users, UserPlus } from 'lucide-react';
import { useModalContext } from '../../../context/modalContext';
import { useEffect } from 'react';
import type { StepProps } from './types';
import { Button } from '../../ui';

export const ChoiceStep = ({ onNext }: Pick<StepProps, 'onNext'>) => {
  const { setActions, setTitle, resetTitle } = useModalContext();

  useEffect(() => {
    setActions(null);
  }, [setActions]);

  useEffect(() => {
    setTitle('Welcome to the Sandbox');
    return () => resetTitle();
  }, [setTitle, resetTitle]);

  return (
    <motion.div
      key="choice"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="space-y-6"
    >
      <p className="text-gray-400 text-center">Choose how you'd like to get started</p>

      <div className="grid gap-4">
        <Button
          type="button"
          variant="card"
          layout="vertical"
          cardColor="purple"
          colorizeHover
          onClick={() => onNext({ action: 'join' })}
          icon={<div className="p-3 bg-brackeys-purple-600 rounded-lg group-hover:bg-brackeys-purple-500 transition-colors">
            <Users className="w-6 h-6 text-white" />
          </div>}
          title="Join Room"
          subtitle="Enter an existing room code to collaborate with others"
          fullWidth
        />
        <Button
          type="button"
          variant="card"
          layout="vertical"
          cardColor="green"
          colorizeHover
          onClick={() => onNext({ action: 'create' })}
          icon={<div className="p-3 bg-green-600 rounded-lg group-hover:bg-green-500 transition-colors">
            <UserPlus className="w-6 h-6 text-white" />
          </div>}
          title="Create Room"
          subtitle="Set up a new room with custom settings and invite others"
          fullWidth
        />
      </div>
    </motion.div>
  );
}; 