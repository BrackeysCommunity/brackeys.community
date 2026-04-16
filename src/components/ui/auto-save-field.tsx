"use client";

import { Alert01Icon, CheckmarkCircle02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ZodObject, ZodRawShape } from "zod";

import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SimpleTooltip } from "@/components/ui/tooltip";

type SaveStatus = "idle" | "saving" | "success" | "error";

type AutoSaveFieldProps<TSchema extends ZodObject<ZodRawShape>, TName extends string> = {
  /** Field name — must be a key in the schema. */
  name: TName;
  /** Zod schema for validation. */
  schema: TSchema;
  /** Current value from server data. */
  initialValue: unknown;
  /** Called with `{ [name]: value }` to persist the change. Return a promise. */
  onSave: (data: Record<string, unknown>) => Promise<unknown>;
  /** Field label. */
  label?: React.ReactNode;
  /** Helper text. */
  hint?: React.ReactNode;
  /** Required indicator. */
  required?: boolean;
  /** Layout direction. */
  layout?: "stack" | "row";
  /** When to trigger save. "blur" for text inputs (default), "change" for checkboxes/switches/radios/selects. */
  saveOn?: "blur" | "change";
  /** Confirmation message before saving. String = always, function = conditional. */
  confirm?: string | ((value: unknown) => string | undefined);
  /** Render prop receiving the field API. */
  // biome-ignore lint/suspicious/noExplicitAny: TanStack field API
  children: (field: any) => React.ReactNode;
  className?: string;
};

/**
 * A standalone auto-save field. Each instance creates its own form.
 * Saves on blur (inputs/textarea) or on change (select/switch/checkbox/radio).
 *
 * Shows inline status indicators: spinner (saving), checkmark (success), warning (error).
 */
function AutoSaveField<TSchema extends ZodObject<ZodRawShape>, TName extends string>({
  name,
  schema,
  initialValue,
  onSave,
  label,
  hint,
  required,
  layout = "stack",
  saveOn = "blur",
  confirm,
  children,
  className,
}: AutoSaveFieldProps<TSchema, TName>) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const form = useForm({
    defaultValues: { [name]: initialValue } as Record<string, unknown>,
    validators: { onDynamic: schema },
    onSubmit: async ({ value }) => {
      // Confirmation dialog
      if (confirm) {
        const msg = typeof confirm === "function" ? confirm(value[name]) : confirm;
        if (msg && !window.confirm(msg)) return;
      }

      setStatus("saving");
      setErrorMessage("");

      try {
        await onSave({ [name]: value[name] });
        setStatus("success");

        // Fade success indicator after 2s
        if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
        successTimeoutRef.current = setTimeout(() => setStatus("idle"), 2000);
      } catch (err) {
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Save failed");
      }
    },
  });

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    };
  }, []);

  const handleSave = useCallback(() => {
    form.handleSubmit();
  }, [form]);

  return (
    <form.Field name={name}>
      {/* biome-ignore lint/suspicious/noExplicitAny: TanStack field render prop */}
      {(field: any) => {
        const errors = field.state.meta.errors as Array<{ message?: string }> | undefined;
        const hasValidationError = errors && errors.length > 0;

        return (
          <Field
            data-slot="auto-save-field"
            orientation={layout === "row" ? "horizontal" : "vertical"}
            data-invalid={hasValidationError || status === "error" || undefined}
            className={className}
          >
            {label && (
              <FieldLabel>
                {label}
                {required && (
                  <span className="ml-0.5 text-destructive" aria-hidden="true">
                    *
                  </span>
                )}
              </FieldLabel>
            )}
            <FieldContent>
              <div className="flex items-start gap-2">
                <SimpleTooltip
                  content={
                    hasValidationError
                      ? errors
                          .map((e) => e?.message)
                          .filter(Boolean)
                          .join(", ")
                      : undefined
                  }
                  variant="error"
                  side="bottom"
                  open={hasValidationError || undefined}
                >
                  <div
                    className="flex-1"
                    onBlur={
                      saveOn === "blur"
                        ? () => {
                            field.handleBlur();
                            handleSave();
                          }
                        : undefined
                    }
                    onChangeCapture={
                      saveOn === "change"
                        ? () => {
                            // Defer to let React state update first
                            setTimeout(handleSave, 0);
                          }
                        : undefined
                    }
                    onClickCapture={
                      saveOn === "change"
                        ? () => {
                            // For checkboxes/switches that don't fire native change
                            setTimeout(handleSave, 0);
                          }
                        : undefined
                    }
                  >
                    {children(field)}
                  </div>
                </SimpleTooltip>
                <StatusIndicator status={status} errorMessage={errorMessage} />
              </div>
              {hint && !hasValidationError && <FieldDescription>{hint}</FieldDescription>}
            </FieldContent>
          </Field>
        );
      }}
    </form.Field>
  );
}

// ── Status Indicator ───────────────────────────────────────────────

function StatusIndicator({ status, errorMessage }: { status: SaveStatus; errorMessage: string }) {
  if (status === "idle") return null;

  if (status === "saving") {
    return (
      <div className="mt-1.5 flex items-center" aria-label="Saving...">
        <HugeiconsIcon
          icon={Loading03Icon}
          strokeWidth={2}
          className="size-4 animate-spin text-muted-foreground"
        />
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="mt-1.5 flex animate-in items-center duration-200 fade-in" aria-label="Saved">
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          strokeWidth={2}
          className="size-4 text-success"
        />
      </div>
    );
  }

  if (status === "error") {
    return (
      <SimpleTooltip content={errorMessage || "Save failed"} variant="error" side="top">
        <div className="mt-1.5 flex items-center" aria-label="Save failed">
          <HugeiconsIcon icon={Alert01Icon} strokeWidth={2} className="size-4 text-destructive" />
        </div>
      </SimpleTooltip>
    );
  }

  return null;
}

export { AutoSaveField };
export type { AutoSaveFieldProps };
