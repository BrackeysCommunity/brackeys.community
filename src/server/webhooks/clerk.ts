import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

// Webhook handler for Clerk events
export const handleClerkWebhook = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      type: z.string(),
      data: z.any(),
    })
  )
  .handler(async ({ data }) => {
    const { type } = data;

    console.log(`Received Clerk webhook: ${type}`);

    // TODO: Implement webhook signature verification
    // TODO: Handle user.created and session.created events
    // TODO: Sync Discord roles

    return { received: true };
  });
