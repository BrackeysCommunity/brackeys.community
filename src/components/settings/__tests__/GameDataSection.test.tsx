import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  forget: vi.fn(),
  confirm: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

// The server function's RPC exists only under Start's compiler; the
// section's own wiring is what is under test.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  createServerFn: ({ method }: { method: string }) => ({
    handler: () => (method === "POST" ? mocks.forget : vi.fn()),
  }),
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: vi.fn() }));
vi.mock("@/components/ui/confirm", () => ({ openConfirmModal: mocks.confirm }));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));

const { GameDataSection } = await import("@/components/settings/GameDataSection");

function show(shown: boolean) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GameDataSection status={{ shown }} index="04" />
    </QueryClientProvider>,
  );
}

const button = () => screen.getByRole("button", { name: /forget me/i });

beforeEach(() => {
  mocks.forget.mockReset();
  mocks.confirm.mockReset();
  mocks.toast.mockReset();
  mocks.toast.success.mockReset();
  mocks.toast.error.mockReset();
});

afterEach(cleanup);

describe("the game data section", () => {
  it("is hidden when forgetting is not enabled for this user", () => {
    const { container } = show(false);

    expect(container.textContent).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("asks through the shared confirm and does nothing on cancel", async () => {
    mocks.confirm.mockResolvedValue(false);
    show(true);
    fireEvent.click(button());

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.confirm.mock.calls[0][0]).toMatchObject({ variant: "destructive" });
    expect(mocks.forget).not.toHaveBeenCalled();
  });

  it("forgets once on confirm and says so", async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.forget.mockResolvedValue({ forgotten: true, swept: false });
    show(true);
    fireEvent.click(button());

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledTimes(1));
    expect(mocks.forget).toHaveBeenCalledTimes(1);
  });

  it("says when the world holds no character", async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.forget.mockResolvedValue({ forgotten: false, swept: false });
    show(true);
    fireEvent.click(button());

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1));
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("reports a world that did not answer", async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.forget.mockRejectedValue(new Error("the world did not forget the player: 0"));
    show(true);
    fireEvent.click(button());

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledTimes(1));
  });
});
