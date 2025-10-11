import { createFileRoute } from '@tanstack/react-router';
import { CollaborationDetail } from '@/pages/CollaborationDetail';

export const Route = createFileRoute('/collaborations/$postId')({
  component: CollaborationDetail,
});
