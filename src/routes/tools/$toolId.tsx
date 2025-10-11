import { createFileRoute } from '@tanstack/react-router';
import { ToolEmbed } from '@/pages/ToolEmbed';

export const Route = createFileRoute('/tools/$toolId')({
  component: ToolEmbed,
});
