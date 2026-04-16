import { useForm } from "@tanstack/react-form";
import type { ZodObject, ZodRawShape } from "zod";

type UseFormConfigOptions<TFormData extends Record<string, unknown>> = {
  /** Zod schema for validation (Standard Schema v1 compatible). */
  schema?: ZodObject<ZodRawShape>;
  /** Default values for the form. */
  defaultValues: TFormData;
  /** Called with validated values on successful submission. */
  onSubmit: (values: TFormData) => void | Promise<void>;
};

/**
 * Thin wrapper around TanStack React Form's `useForm` that applies
 * Zod validation via TanStack Form's built-in Standard Schema support.
 *
 * The schema is set as `validators.onSubmit` so validation runs on submit,
 * and field-level errors are automatically populated by TanStack Form.
 */
export function useFormConfig<TFormData extends Record<string, unknown>>({
  schema,
  defaultValues,
  onSubmit,
}: UseFormConfigOptions<TFormData>) {
  return useForm({
    defaultValues,
    // biome-ignore lint/suspicious/noExplicitAny: TanStack Form's generic validators are extremely complex
    validators: schema ? ({ onSubmit: schema } as any) : undefined,
    // biome-ignore lint/suspicious/noExplicitAny: TanStack Form's onSubmit typing is complex
    onSubmit: async ({ value }: any) => {
      await onSubmit(value as TFormData);
    },
  });
}
