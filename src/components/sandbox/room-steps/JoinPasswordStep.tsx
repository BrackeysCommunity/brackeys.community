import { useForm } from '@tanstack/react-form';
import { motion } from 'framer-motion';
import { ArrowRight, Lock } from 'lucide-react';
import { Button, Input } from '../../ui';
import { useModalContext } from '../../../context/modalContext';
import { useEffect } from 'react';
import type { StepProps } from './types';
import { joinPasswordSchema } from './types';

export const JoinPasswordStep = ({ onNext, loading, formData }: StepProps) => {
  const { setActions, setTitle, resetTitle } = useModalContext();
  const form = useForm({
    defaultValues: {
      password: formData.password,
    },
    onSubmit: async ({ value }) => {
      onNext(value);
    },
    validators: {
      onSubmit: joinPasswordSchema,
    },
  });

  useEffect(() => {
    setTitle('Join Room');
    return () => resetTitle();
  }, [setTitle, resetTitle]);

  useEffect(() => {
    setActions(
      <Button
        onClick={() => form.handleSubmit()}
        disabled={!form.state.canSubmit}
        loading={loading}
        fullWidth
      >
        {loading ? 'Joining...' : 'Join Room'}
        {!loading && <ArrowRight className="w-5 h-5" />}
      </Button>,
    );
  }, [form.state.canSubmit, loading, setActions, form]);

  return (
    <motion.div
      key="join-password"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="space-y-6"
    >
      <div className="bg-yellow-900/50 text-yellow-400 border border-yellow-700 text-sm p-4 rounded-lg flex items-start space-x-3">
        <Lock className="w-5 h-5 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-semibold">Password Required</p>
          <p>Room "{formData.roomCode}" is password protected</p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
        noValidate
      >
        <form.Field name="password">
          {(field) => (
            <div>
              <label className="block text-sm text-gray-300 mb-2">
                Password
              </label>
              <Input
                type="password"
                value={field.state.value}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                placeholder="Enter room password..."
                autoFocus
                error={!!field.state.meta.errors?.length}
              />
              {field.state.meta.errors &&
                field.state.meta.errors.length > 0 && (
                  <p className="text-red-400 text-sm mt-1">
                    {field.state.meta.errors[0]?.message || 'Invalid input'}
                  </p>
                )}
            </div>
          )}
        </form.Field>
      </form>
    </motion.div>
  );
};
