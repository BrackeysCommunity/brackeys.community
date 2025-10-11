import { useForm } from '@tanstack/react-form';
import { RadioGroup } from '@headlessui/react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Globe, Lock, Clock, FastForward } from 'lucide-react';
import { Button, Input } from '../../ui';
import { useModalContext } from '../../../context/modalContext';
import { useEffect, useState } from 'react';
import type { StepProps } from './types';
import { ColorPickerInput } from '../../ColorPickerInput';
import { RAINBOW_PALETTE } from '../../../lib/colors';

export const CreateConfigStep = ({ onNext, loading, formData }: StepProps) => {
  const { setActions, setTitle, resetTitle } = useModalContext();
  const [validFields, setValidFields] = useState({
    userName: false,
    userColor: !!formData.userColor,
    password: true,
  });
  const form = useForm({
    defaultValues: {
      userName: formData.userName,
      userColor: formData.userColor || RAINBOW_PALETTE[0],
      usePassword: formData.usePassword,
      password: formData.password,
      messageMode: formData.messageMode,
      messageTtl: formData.messageTtl,
    },
    onSubmit: async ({ value }) => {
      onNext(value);
    },
  });

  useEffect(() => {
    setTitle('Create Room');
    return () => resetTitle();
  }, [setTitle, resetTitle]);

  useEffect(() => {
    setActions(
      <Button
        onClick={() => form.handleSubmit()}
        disabled={
          !validFields.userName ||
          !validFields.userColor ||
          !validFields.password
        }
        loading={loading}
        fullWidth
        variant="success"
      >
        {loading ? 'Creating...' : 'Create Room'}
        {!loading && <ArrowRight className="w-5 h-5" />}
      </Button>,
    );
  }, [form.state.canSubmit, loading, setActions, form, validFields]);

  return (
    <motion.div
      key="create-config"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="space-y-6"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
        noValidate
      >
        <div>
          {/* User Name & Color */}
          <form.Field name="userName">
            {(nameField) => (
              <form.Field name="userColor">
                {(colorField) => {
                  const handleNameChange = (value: string) => {
                    nameField.handleChange(value);
                    const isValid = !!value?.trim();
                    setValidFields((prev) => ({ ...prev, userName: isValid }));
                  };

                  const handleColorChange = (value: string) => {
                    colorField.handleChange(value);
                    const isValid = RAINBOW_PALETTE.includes(value);
                    setValidFields((prev) => ({ ...prev, userColor: isValid }));
                  };

                  return (
                    <div>
                      <label className="block text-sm text-gray-300 mb-2">
                        Your Name & Color
                      </label>
                      <ColorPickerInput
                        value={nameField.state.value}
                        onChange={handleNameChange}
                        onBlur={nameField.handleBlur}
                        selectedColor={colorField.state.value}
                        onColorSelect={handleColorChange}
                        placeholder="Enter your name..."
                        autoFocus
                        error={
                          !!nameField.state.meta.errors?.length ||
                          !!colorField.state.meta.errors?.length
                        }
                      />
                      {nameField.state.meta.errors &&
                        nameField.state.meta.errors.length > 0 && (
                          <p className="text-red-400 text-sm mt-1">
                            {(() => {
                              const error = nameField.state.meta.errors[0];
                              return typeof error === 'string'
                                ? error
                                : (error as unknown as Error)?.message ||
                                    'Invalid input';
                            })()}
                          </p>
                        )}
                      {colorField.state.meta.errors &&
                        colorField.state.meta.errors.length > 0 && (
                          <p className="text-red-400 text-sm mt-1">
                            {(() => {
                              const error = colorField.state.meta.errors[0];
                              return typeof error === 'string'
                                ? error
                                : (error as unknown as Error)?.message ||
                                    'Invalid input';
                            })()}
                          </p>
                        )}
                    </div>
                  );
                }}
              </form.Field>
            )}
          </form.Field>

          {/* Room Privacy */}
          <div className="mt-6">
            <label className="block text-sm text-gray-300 mb-3">
              Room Privacy
            </label>
            <form.Field
              name="usePassword"
              validators={{
                onChange: ({ value }) => {
                  setValidFields({ ...validFields, password: !value });
                  return undefined;
                },
              }}
            >
              {(field) => (
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant="card"
                    layout="horizontal"
                    selected={!field.state.value}
                    cardColor="green"
                    onClick={() => field.handleChange(false)}
                    icon={<Globe />}
                    title="Public"
                    subtitle="Anyone can join"
                  />
                  <Button
                    type="button"
                    variant="card"
                    layout="horizontal"
                    selected={field.state.value}
                    cardColor="yellow"
                    onClick={() => field.handleChange(true)}
                    icon={<Lock />}
                    title="Private"
                    subtitle="Password required"
                  />
                </div>
              )}
            </form.Field>
          </div>

          {/* Password Field */}
          <form.Field name="usePassword">
            {(privacyField) => (
              <AnimatePresence mode="sync">
                {privacyField.state.value && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginTop: 24 }}
                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                  >
                    <form.Field
                      name="password"
                      validators={{
                        onMount: ({ value, fieldApi }) => {
                          const isInvalid = !value || value.length < 4;
                          const usePassword =
                            fieldApi.form.getFieldValue('usePassword');
                          setValidFields({
                            ...validFields,
                            password: !isInvalid || !usePassword,
                          });
                          return usePassword && isInvalid
                            ? 'Password must be at least 4 characters'
                            : undefined;
                        },
                        onChange: ({ value, fieldApi }) => {
                          const isInvalid = !value || value.length < 4;
                          const usePassword =
                            fieldApi.form.getFieldValue('usePassword');
                          setValidFields({
                            ...validFields,
                            password: !isInvalid || !usePassword,
                          });
                          return usePassword && isInvalid
                            ? 'Password must be at least 4 characters'
                            : undefined;
                        },
                      }}
                    >
                      {(field) => (
                        <div>
                          <label className="block text-sm text-gray-300 mb-2">
                            Room Password
                          </label>
                          <Input
                            type="password"
                            value={field.state.value || ''}
                            onChange={field.handleChange}
                            onBlur={field.handleBlur}
                            placeholder="Min 4 characters..."
                            error={!!field.state.meta.errors?.length}
                          />
                          {field.state.meta.errors &&
                            field.state.meta.errors.length > 0 && (
                              <p className="text-red-400 text-sm mt-1">
                                {field.state.meta.errors[0]}
                              </p>
                            )}
                        </div>
                      )}
                    </form.Field>
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </form.Field>

          {/* Message Mode */}
          <div className="mt-6">
            <label className="block text-sm text-gray-300 mb-3">
              Message Mode
            </label>
            <form.Field name="messageMode">
              {(field) => (
                <RadioGroup
                  value={field.state.value}
                  onChange={field.handleChange}
                >
                  <RadioGroup.Label className="sr-only">
                    Message Mode
                  </RadioGroup.Label>
                  <div className="space-y-3">
                    <RadioGroup.Option value="live">
                      {({ checked }) => (
                        <Button
                          type="button"
                          variant="checkbox-card"
                          layout="vertical"
                          selected={checked}
                          cardColor="purple"
                          onClick={() => field.handleChange('live')}
                          icon={<FastForward className="w-5 h-5 text-white" />}
                          title="Rapid Fire"
                          subtitle="Sending messages doesn't post a message bubble. Great for large group chats where the bubbles start overtaking the conversation."
                          fullWidth
                        />
                      )}
                    </RadioGroup.Option>

                    <RadioGroup.Option value="ephemeral">
                      {({ checked }) => (
                        <Button
                          type="button"
                          variant="checkbox-card"
                          layout="vertical"
                          selected={checked}
                          cardColor="blue"
                          onClick={() => field.handleChange('ephemeral')}
                          icon={<Clock className="w-5 h-5 text-white" />}
                          title="Ephemeral Mode"
                          subtitle="Messages persist until manually dismissed. Perfect for ongoing conversations and quick 1-on-1 chats."
                          fullWidth
                        />
                      )}
                    </RadioGroup.Option>
                  </div>
                </RadioGroup>
              )}
            </form.Field>
          </div>

          {/* TTL Configuration */}
          <form.Field name="messageMode">
            {(modeField) => (
              <AnimatePresence>
                {modeField.state.value === 'ephemeral' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginTop: 24 }}
                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                  >
                    <form.Field name="messageTtl">
                      {(field) => (
                        <div>
                          <label className="block text-sm text-gray-300 mb-2">
                            Message Lifetime (seconds)
                          </label>
                          <Input
                            type="number"
                            value={field.state.value}
                            onChange={(value) =>
                              field.handleChange(
                                Math.max(1, parseInt(value) || 1),
                              )
                            }
                            onBlur={field.handleBlur}
                            className="font-mono"
                            min={1}
                            placeholder="30"
                            error={!!field.state.meta.errors?.length}
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            How long messages stay visible before disappearing
                          </p>
                          {field.state.meta.errors &&
                            field.state.meta.errors.length > 0 && (
                              <p className="text-red-400 text-sm mt-1">
                                {field.state.meta.errors[0]}
                              </p>
                            )}
                        </div>
                      )}
                    </form.Field>
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </form.Field>
        </div>
      </form>
    </motion.div>
  );
};
