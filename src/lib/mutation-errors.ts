import { errorMessage } from "@/lib/error-message";
import { reportMutationError } from "@/lib/posthog";
import { toast } from "@/lib/toast";

/**
 * `onError` factory for the standard mutation failure path: toast the
 * message *and* report the error. Before this, every `onError` in the app
 * toasted (or set local state) and dropped the error — a network failure
 * and a validation rejection vanished identically.
 *
 * ```ts
 * useMutation({ ...opts, onError: toastMutationError("comments.create") })
 * ```
 *
 * `scope` names the mutation (`area.action`) and is what the error-rate
 * dashboard groups by. `fallback` replaces the message when the error
 * carries none. Reporting applies the expected-error filter — see
 * `reportMutationError` in `@/lib/posthog`.
 *
 * Sites with extra failure work (optimistic rollback, local error state)
 * keep their own handler and call `reportMutationError` +
 * `errorMessage` themselves.
 */
export function toastMutationError(
  scope: string,
  fallback?: string,
  properties?: Record<string, unknown>,
) {
  return (error: unknown) => {
    reportMutationError(error, scope, properties);
    toast.error(errorMessage(error, fallback));
  };
}
