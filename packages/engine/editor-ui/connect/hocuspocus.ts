import type { HocuspocusModule, ProjectSocketStatus, ProjectTransport } from "../host";

/**
 * One `HocuspocusProviderWebsocket` from the module the host passes in, with
 * a `HocuspocusProvider` per doc attached to it. Each provider reports its
 * doc's unacknowledged updates, so the editor can say when the server holds
 * every edit.
 */
export function hocuspocusTransport(mod: HocuspocusModule): ProjectTransport {
  return (url) => {
    const listeners = new Set<() => void>();
    const socket = new mod.HocuspocusProviderWebsocket({
      url,
      onStatus: () => {
        for (const l of listeners) l();
      },
    });
    const status = (): ProjectSocketStatus =>
      socket.status === mod.WebSocketStatus.Connected
        ? "connected"
        : socket.status === mod.WebSocketStatus.Connecting
          ? "connecting"
          : "disconnected";
    return {
      status,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      provider({ name, doc, token, events }) {
        const provider = new mod.HocuspocusProvider({
          websocketProvider: socket,
          name,
          document: doc,
          token,
          onSynced: ({ state }) => {
            if (state) events.synced();
          },
          onAuthenticationFailed: ({ reason }) =>
            events.closed(null, status() === "connected", reason),
          onClose: ({ event }) =>
            events.closed(
              typeof event?.code === "number" ? event.code : null,
              status() === "connected",
              event?.reason,
            ),
          onStateless: ({ payload }) => events.stateless?.(payload),
          onUnsyncedChanges: ({ number }) => events.unsynced?.(number),
        });
        const awareness = provider.awareness;
        if (!awareness) throw new Error(`"${name}": the provider has no awareness`);
        provider.attach();
        return {
          awareness,
          attach: () => provider.attach(),
          detach: () => provider.detach(),
          destroy: () => provider.destroy(),
        };
      },
      destroy() {
        listeners.clear();
        socket.destroy();
      },
    };
  };
}
