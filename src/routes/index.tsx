import { createFileRoute } from '@tanstack/react-router';
import { Home } from '@/pages/Home';

export const Route = createFileRoute('/')({
  component: Home,
  head: () => ({
    meta: [{ title: 'Home - Brackeys Community' }],
  }),
});
