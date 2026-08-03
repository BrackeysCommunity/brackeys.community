"use client";

import * as React from "react";

/**
 * Where overlay popups (select, etc.) should portal when the ambient
 * surface is a focus-trapping dialog. Popups portaled to <body> sit
 * outside a dialog's focus trap, so the trap yanks focus back the moment
 * they open and the popup dismisses itself; portaling into the dialog's
 * own subtree keeps focus inside the trap. Surfaces that trap focus
 * (the vaul drawer) provide a container here; everywhere else this is
 * null and popups portal to <body> as usual.
 */
const PortalContainerContext = React.createContext<HTMLElement | null>(null);

export const PortalContainerProvider = PortalContainerContext.Provider;

export function usePortalContainer(): HTMLElement | null {
  return React.useContext(PortalContainerContext);
}
