import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/ogprobe")({
  server: {
    handlers: {
      GET: async () => {
        const { probe } = await import("@/lib/og/probe");
        return new Response(JSON.stringify(probe()), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
