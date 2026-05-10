import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy detail route — redirects to the browse page with the post
// popover open via `?post=<id>`. Keeps any existing inbound links and
// shared URLs working without rendering the now-superseded detail page.
export const Route = createFileRoute("/collab/$postId")({
  beforeLoad: ({ params }) => {
    const postId = Number(params.postId);
    if (!Number.isFinite(postId) || postId <= 0) {
      throw redirect({ to: "/collab", search: {} });
    }
    throw redirect({ to: "/collab", search: { post: postId } });
  },
});
