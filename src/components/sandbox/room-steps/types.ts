import { z } from 'zod';

export type StepType = 'choice' | 'join-details' | 'join-password' | 'create-config';
export type ActionType = 'create' | 'join';
export type MessageMode = 'live' | 'ephemeral';

export interface FormData {
  action: ActionType;
  userName: string;
  roomCode: string;
  password: string;
  usePassword: boolean;
  messageMode: MessageMode;
  messageTtl: number;
}

export interface StepProps {
  onNext: (data?: Partial<FormData>) => void;
  onBack: () => void;
  loading: boolean;
  formData: FormData;
}

// Validation schemas
export const joinDetailsSchema = z.object({
  userName: z.string().min(1, 'Name is required'),
  roomCode: z.string().length(6, 'Room code must be 6 characters'),
});

export const joinPasswordSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

export const createConfigSchema = z.object({
  userName: z.string().min(1, 'Name is required'),
  usePassword: z.boolean(),
  password: z.string().optional(),
  messageMode: z.enum(['live', 'ephemeral']),
  messageTtl: z.number().min(1),
}).refine((data) => {
  if (data.usePassword && (!data.password || data.password.length < 4)) {
    return false;
  }
  return true;
}, {
  message: "Password must be at least 4 characters when enabled",
  path: ["password"],
}); 