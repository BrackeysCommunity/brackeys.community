import { createFileRoute } from '@tanstack/react-router';
import { Snake } from '@/components/games/snake/Snake';

export const Route = createFileRoute('/games/snake')({
  component: Snake,
  head: () => ({
    meta: [{ title: 'Snake Game - Brackeys Community' }],
  }),
});
