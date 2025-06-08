import { useForm } from '@tanstack/react-form';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { Button, Input } from '../../ui';
import { useModalContext } from '../../../context/modalContext';
import { useEffect, useState } from 'react';
import type { StepProps } from './types';
import { joinDetailsSchema } from './types';

export const JoinDetailsStep = ({ onNext, onBack, loading, formData }: StepProps) => {
  const { setActions, setTitle, resetTitle } = useModalContext();
  const [validFields, setValidFields] = useState({
    userName: false,
    roomCode: false,
  });
  const form = useForm({
    defaultValues: {
      userName: formData.userName,
      roomCode: formData.roomCode,
    },
    onSubmit: async ({ value }) => {
      onNext(value);
    },
    validators: {
      onSubmit: joinDetailsSchema,
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
        disabled={!validFields.userName || !validFields.roomCode || loading}
        loading={loading}
        fullWidth
      >
        {loading ? 'Joining...' : 'Join Room'}
        {!loading && <ArrowRight className="w-5 h-5" />}
      </Button>
    );
  }, [form.state.canSubmit, form.state.isValid, loading, setActions, form, validFields]);

  return (
    <motion.div
      key="join-details"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="space-y-6"
    >
      <form onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }} noValidate>
        <div className="space-y-4">
          <form.Field
            name="userName"
            validators={{
              onChange: ({ value }) => {
                const isValid = !!value?.trim();
                setValidFields({ ...validFields, userName: isValid });
                return isValid ? undefined : 'Name is required';
              },
            }}
          >
            {(field) => (
              <div>
                <label className="block text-sm text-gray-300 mb-2">Your Name</label>
                <Input
                  type="text"
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  placeholder="Enter your name..."
                  autoFocus
                  error={!!field.state.meta.errors?.length}
                />
                {field.state.meta.errors && field.state.meta.errors.length > 0 && (
                  <p className="text-red-400 text-sm mt-1">
                    {typeof field.state.meta.errors[0] === 'string' ? field.state.meta.errors[0] : field.state.meta.errors[0]?.message || 'Invalid input'}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <form.Field
            name="roomCode"
            validators={{
              onChange: ({ value }) => {
                const isValid = !!(value?.trim() && value.length === 6);
                setValidFields({ ...validFields, roomCode: isValid });
                return isValid ? undefined : 'Room code must be 6 characters';
              },
            }}
          >
            {(field) => (
              <div>
                <label className="block text-sm text-gray-300 mb-2">Room Code</label>
                <Input
                  type="text"
                  value={field.state.value}
                  onChange={(value) => field.handleChange(value.toUpperCase())}
                  onBlur={field.handleBlur}
                  className="font-mono text-center text-lg tracking-wider"
                  placeholder="ABC123"
                  maxLength={6}
                  error={!!field.state.meta.errors?.length}
                />
                {field.state.meta.errors && field.state.meta.errors.length > 0 && (
                  <p className="text-red-400 text-sm mt-1">
                    {typeof field.state.meta.errors[0] === 'string' ? field.state.meta.errors[0] : field.state.meta.errors[0]?.message || 'Invalid input'}
                  </p>
                )}
              </div>
            )}
          </form.Field>
        </div>
      </form>
    </motion.div>
  );
}; 