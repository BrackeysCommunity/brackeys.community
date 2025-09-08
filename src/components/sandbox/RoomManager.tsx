import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { RadioGroup } from '@headlessui/react';
import { toast } from '../../lib/toast';
import { useSpacetimeDB } from '../../context/spacetimeDBContext';
import { Modal, Button, Input } from '../ui';
import {
  ChoiceStep,
  JoinDetailsStep,
  JoinPasswordStep,
  CreateConfigStep,
  type StepType,
  type FormData,
} from './room-steps';
import { MessageCircle, Clock } from 'lucide-react';
import { RAINBOW_PALETTE } from '../../lib/colors';
import { ColorPicker } from '../ColorPicker';
import { useMounted } from '../../hooks/useMounted';

const ROOM_SECRET_KEY = import.meta.env.VITE_SPACETIME_ROOM_KEY || 'brackeys-default-key';

interface RoomManagerProps {
  onClose?: () => void;
}

export const RoomManager = ({ onClose }: RoomManagerProps) => {
  const {
    currentUser,
    currentRoom,
    createRoom,
    joinRoom,
    leaveRoom,
    updateRoomConfig,
    setDisplayName,
    updateColor,
  } = useSpacetimeDB();
  const [step, setStep] = useState<StepType>('choice');
  const [loading, setLoading] = useState(false);
  const [selectedColor, setSelectedColor] = useState(currentUser?.color || RAINBOW_PALETTE[0]);
  const isMounted = useMounted();
  const [formData, setFormData] = useState<FormData>({
    action: 'join',
    userName: currentUser?.name || '',
    userColor:
      currentUser?.color || RAINBOW_PALETTE[Math.floor(Math.random() * RAINBOW_PALETTE.length)],
    roomCode: '',
    password: '',
    usePassword: false,
    messageMode: 'ephemeral',
    messageTtl: 30,
  });
  const [roomMessageMode, setRoomMessageMode] = useState<'live' | 'ephemeral'>(
    currentRoom && currentRoom.messageTtlSeconds === 0 ? 'live' : 'ephemeral'
  );
  const [roomTtl, setRoomTtl] = useState(
    currentRoom && currentRoom.messageTtlSeconds > 0 ? currentRoom.messageTtlSeconds : 30
  );

  const hashPassword = async (pwd: string): Promise<string> => {
    if (!pwd) return '';
    const pepperedPassword = pwd + ROOM_SECRET_KEY;
    const encoder = new TextEncoder();
    const data = encoder.encode(pepperedPassword);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleJoinAttempt = async (
    code: string,
    pwd: string = ''
  ): Promise<'success' | 'room-not-found' | 'invalid-password' | 'needs-password' | 'error'> => {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Room join timeout - please try again')), 10000);
    });

    try {
      if (!pwd) {
        await Promise.race([joinRoom(code.toUpperCase(), ''), timeoutPromise]);
        return 'success';
      }

      const hashedPassword = await hashPassword(pwd);
      await Promise.race([joinRoom(code.toUpperCase(), hashedPassword), timeoutPromise]);
      return 'success';
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('timeout')) {
        toast.error('Connection timeout. Please check your internet and try again.');
        return 'error';
      } else if (err instanceof Error && err.message?.includes('Room not found')) {
        toast.error('Room not found. Please check the room code.');
        return 'room-not-found';
      } else if (err instanceof Error && err.message?.includes('Invalid password')) {
        if (pwd) {
          toast.error('Incorrect password. Please try again.');
          return 'invalid-password';
        } else {
          // Room exists but requires password, return special code to trigger password step
          return 'needs-password';
        }
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to join room. Please try again.');
        return 'error';
      }
    }
  };

  const handleNext = async (data?: Partial<FormData>) => {
    if (data) {
      setFormData(prev => ({ ...prev, ...data }));
    }

    const currentFormData = { ...formData, ...data };
    setLoading(true);

    try {
      // Set display name first if needed
      if (!currentUser?.name && currentFormData.userName?.trim()) {
        await setDisplayName(currentFormData.userName.trim(), currentFormData.userColor);
      }

      // Handle step navigation first
      if (step === 'choice') {
        const nextStep = currentFormData.action === 'create' ? 'create-config' : 'join-details';
        setStep(nextStep);
      } else if (currentFormData.action === 'create' && step === 'create-config') {
        const hashedPassword =
          currentFormData.usePassword && currentFormData.password
            ? await hashPassword(currentFormData.password)
            : '';
        const messageTtl = currentFormData.messageMode === 'live' ? 0 : currentFormData.messageTtl;
        const code = await createRoom(hashedPassword, messageTtl, true);
        toast.success(`Room created! Code: ${code}`);
        onClose?.();
      } else if (currentFormData.action === 'join') {
        if (step === 'join-details') {
          const result = await handleJoinAttempt(currentFormData.roomCode);
          if (result === 'success') {
            onClose?.();
          } else if (result === 'needs-password') {
            setStep('join-password');
          }
          // For 'room-not-found', 'error', etc., error message already shown, stay on current step
        } else if (step === 'join-password') {
          const result = await handleJoinAttempt(
            currentFormData.roomCode,
            currentFormData.password
          );
          if (result === 'success') {
            onClose?.();
          }
          // For any error, stay on password step (error message already shown)
        }
      }
    } catch (err: unknown) {
      console.error('Step submission error:', err);
      toast.error(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step === 'join-details' || step === 'create-config') {
      setStep('choice');
    } else if (step === 'join-password') {
      setStep('join-details');
    }
  };

  const handleLeaveRoom = async () => {
    setLoading(true);
    try {
      await leaveRoom();
      onClose?.();
    } catch (err: unknown) {
      console.error('Failed to leave room:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to leave room');
    } finally {
      setLoading(false);
    }
  };

  // If already in a room, show room settings
  if (currentRoom) {
    const isHost =
      currentUser && currentRoom.hostIdentity.toHexString() === currentUser.identity.toHexString();

    return (
      <Modal isOpen={true} onClose={onClose} title="Room Settings" maxWidth="md">
        <motion.div
          key="room-settings"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="[&>*:not(:last-child)]:mb-6 [&>*:last-child]:-mt-2"
        >
          <div className="space-y-3 mb-6 text-gray-300">
            <div className="flex justify-between">
              <span className="text-gray-400">Room Code:</span>
              <span className="font-mono font-semibold text-brackeys-purple-400">
                {currentRoom.code}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Message TTL:</span>
              <span>
                {currentRoom.messageTtlSeconds === 0
                  ? 'Never expire'
                  : `${currentRoom.messageTtlSeconds}s`}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Messages:</span>
              <span className={currentRoom.messagesEnabled ? 'text-green-400' : 'text-yellow-400'}>
                {currentRoom.messagesEnabled ? 'Enabled' : 'Typing only'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Password:</span>
              <span className={currentRoom.passwordHash ? 'text-yellow-400' : 'text-green-400'}>
                {currentRoom.passwordHash ? 'Protected' : 'Public'}
              </span>
            </div>
          </div>

          {/* User Color Selection */}
          <div className="mb-6">
            <label className="block text-sm text-gray-300 mb-2">Your Color</label>
            <ColorPicker
              selectedColor={selectedColor}
              onColorSelect={async color => {
                setSelectedColor(color);
                setLoading(true);
                try {
                  await updateColor(color);
                  toast.success('Color updated!');
                } catch (err: unknown) {
                  console.error('Failed to update color:', err);
                  toast.error(err instanceof Error ? err.message : 'Failed to update color');
                  // Revert color on error
                  setSelectedColor(currentUser?.color || RAINBOW_PALETTE[0]);
                } finally {
                  setLoading(false);
                }
              }}
            />
          </div>

          {isHost && (
            <div className="mb-6 space-y-6">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-brackeys-purple-600 rounded-lg">
                  <svg
                    className="w-5 h-5 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white">Host Controls</h3>
              </div>

              <div className="space-y-6">
                {/* Message Mode */}
                <div>
                  <label className="block text-sm text-gray-300 mb-3">Message Mode</label>
                  <RadioGroup value={roomMessageMode} onChange={setRoomMessageMode}>
                    <RadioGroup.Label className="sr-only">Message Mode</RadioGroup.Label>
                    <div className="space-y-3">
                      <RadioGroup.Option value="live">
                        {({ checked }) => (
                          <Button
                            type="button"
                            variant="checkbox-card"
                            layout="vertical"
                            selected={checked}
                            cardColor="purple"
                            onClick={() => setRoomMessageMode('live')}
                            icon={<MessageCircle className="w-5 h-5 text-white" />}
                            title="Live Mode"
                            subtitle="Messages persist until manually dismissed. Perfect for ongoing conversations."
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
                            onClick={() => setRoomMessageMode('ephemeral')}
                            icon={<Clock className="w-5 h-5 text-white" />}
                            title="Ephemeral Mode"
                            subtitle="Messages auto-expire after a set time. Great for quick brainstorming sessions."
                            fullWidth
                          />
                        )}
                      </RadioGroup.Option>
                    </div>
                  </RadioGroup>
                </div>

                {/* TTL Configuration */}
                <AnimatePresence mode="sync">
                  {roomMessageMode === 'ephemeral' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0, translateY: -12, marginTop: 0 }}
                      animate={{ opacity: 1, height: 'auto', translateY: 0, marginTop: 24 }}
                      exit={{ opacity: 0, height: 0, translateY: -12, marginTop: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                    >
                      <div>
                        <label className="block text-sm text-gray-300 mb-2">
                          Message Lifetime (seconds)
                        </label>
                        <Input
                          type="number"
                          value={roomTtl}
                          onChange={value => setRoomTtl(Math.max(1, parseInt(value) || 1))}
                          className="font-mono"
                          min={1}
                          placeholder="30"
                          tabIndex={isMounted ? 0 : -1}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          How long messages stay visible before disappearing
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="mt-6">
                  <Button
                    onClick={async () => {
                      setLoading(true);
                      try {
                        const ttl = roomMessageMode === 'live' ? 0 : roomTtl;
                        await updateRoomConfig(ttl, currentRoom.messagesEnabled);
                        toast.success('Settings updated successfully!');
                      } catch (err: unknown) {
                        console.error('Failed to update settings:', err);
                        toast.error(
                          err instanceof Error ? err.message : 'Failed to update settings'
                        );
                      } finally {
                        setLoading(false);
                      }
                    }}
                    loading={loading}
                    variant="success"
                    fullWidth
                  >
                    {loading ? 'Updating...' : 'Update Settings'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <Button onClick={handleLeaveRoom} loading={loading} variant="danger" fullWidth>
            {loading ? 'Leaving...' : 'Leave Room'}
          </Button>
        </motion.div>
      </Modal>
    );
  }

  const stepComponents = {
    choice: <ChoiceStep onNext={handleNext} />,
    'join-details': (
      <JoinDetailsStep
        onNext={handleNext}
        onBack={handleBack}
        loading={loading}
        formData={formData}
      />
    ),
    'join-password': (
      <JoinPasswordStep
        onNext={handleNext}
        onBack={handleBack}
        loading={loading}
        formData={formData}
      />
    ),
    'create-config': (
      <CreateConfigStep
        onNext={handleNext}
        onBack={handleBack}
        loading={loading}
        formData={formData}
      />
    ),
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      onBack={step !== 'choice' ? handleBack : undefined}
      showCloseButton={true}
      allowEscape={!onClose}
      maxWidth="md"
    >
      <AnimatePresence mode="wait">{stepComponents[step]}</AnimatePresence>
    </Modal>
  );
};
