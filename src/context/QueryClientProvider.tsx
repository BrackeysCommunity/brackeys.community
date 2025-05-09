import { ReactNode } from "react";
import { QueryClientProvider as Provider } from "@tanstack/react-query";
import { queryClient } from "./queryClientContext";

export const QueryClientProvider = ({ children }: { children: ReactNode }) => (
  <Provider client={queryClient}>
    {children}
  </Provider>
);