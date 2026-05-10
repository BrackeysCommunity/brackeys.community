import { createContext, useContext } from "react";

import type { AnyFieldApi, AnyFormStore, WizardFormValues } from "./shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WizardFormContext = createContext<any>(null);

export function useWizardForm() {
  const form = useContext(WizardFormContext);
  if (!form) throw new Error("useWizardForm must be used within WizardFormContext");
  return form as {
    Field: React.FC<{
      name: keyof WizardFormValues;
      validators?: Record<string, unknown>;
      children: (field: AnyFieldApi) => React.ReactNode;
    }>;
    store: import("@tanstack/store").Store<AnyFormStore>;
    setFieldValue: (name: keyof WizardFormValues, value: unknown) => void;
    handleSubmit: () => void;
    state: AnyFormStore;
  };
}
