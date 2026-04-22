"use client";

import * as React from "react";
import { createContext, useContext, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ── Form Context ───────────────────────────────────────────────────

type FormContextValue = {
  // biome-ignore lint/suspicious/noExplicitAny: TanStack Form API is heavily generic
  form: any;
  /** Ordered list of field names as they appear in the form. */
  fieldOrder: React.RefObject<string[]>;
};

const FormContext = createContext<FormContextValue | null>(null);

function useFormContext() {
  const ctx = useContext(FormContext);
  if (!ctx) throw new Error("useFormContext must be used within a <Form>");
  return ctx;
}

// ── Form ───────────────────────────────────────────────────────────

type FormProps = React.ComponentProps<"form"> & {
  // biome-ignore lint/suspicious/noExplicitAny: TanStack Form API
  form: any;
};

function Form({ form, className, children, ...props }: FormProps) {
  const fieldOrder = React.useRef<string[]>([]);

  return (
    <FormContext.Provider value={{ form, fieldOrder }}>
      <form
        data-slot="form"
        noValidate
        className={cn("flex flex-col gap-4", className)}
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        {...props}
      >
        {children}
      </form>
    </FormContext.Provider>
  );
}

// ── FormField ──────────────────────────────────────────────────────

type FormFieldProps = {
  name: string;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  required?: boolean;
  layout?: "stack" | "row";
  className?: string;
  // biome-ignore lint/suspicious/noExplicitAny: field render prop
  children: (field: any) => React.ReactNode;
};

function getFieldErrors(field: { state: { meta: { errors?: unknown[] } } }): string[] {
  const raw = field.state.meta.errors as unknown[];
  if (!raw?.length) return [];
  return raw
    .map((e: unknown) => (typeof e === "string" ? e : (e as { message?: string })?.message))
    .filter(Boolean) as string[];
}

function FormField({
  name,
  label,
  hint,
  required,
  layout = "stack",
  className,
  children,
}: FormFieldProps) {
  const { form, fieldOrder } = useFormContext();

  // Register field order on mount
  React.useEffect(() => {
    const order = fieldOrder.current;
    if (!order.includes(name)) {
      order.push(name);
    }
    return () => {
      const idx = order.indexOf(name);
      if (idx !== -1) order.splice(idx, 1);
    };
  }, [name, fieldOrder]);

  return (
    <form.Field name={name}>
      {/* biome-ignore lint/suspicious/noExplicitAny: TanStack field render prop */}
      {(field: any) => {
        const errorMessages = getFieldErrors(field);
        const hasError = errorMessages.length > 0;

        return (
          <FormFieldInner
            name={name}
            label={label}
            hint={hint}
            required={required}
            layout={layout}
            className={className}
            hasError={hasError}
            errorMessages={errorMessages}
            field={field}
          >
            {children}
          </FormFieldInner>
        );
      }}
    </form.Field>
  );
}

/**
 * Inner component that subscribes to form state to determine if THIS field
 * should show its error tooltip (only the last errored field shows it).
 */
function FormFieldInner({
  name,
  label,
  hint,
  required,
  layout = "stack",
  className,
  hasError,
  errorMessages,
  field,
  children,
}: {
  name: string;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  required?: boolean;
  layout?: "stack" | "row";
  className?: string;
  hasError: boolean;
  errorMessages: string[];
  // biome-ignore lint/suspicious/noExplicitAny: TanStack field API
  field: any;
  // biome-ignore lint/suspicious/noExplicitAny: field render prop
  children: (field: any) => React.ReactNode;
}) {
  const { form, fieldOrder } = useFormContext();

  // Determine if this is the last errored field (for tooltip display)
  const showTooltip = useMemo(() => {
    if (!hasError) return false;
    // Find the last field in order that has errors
    const order = fieldOrder.current;
    for (let i = order.length - 1; i >= 0; i--) {
      const fieldName = order[i];
      try {
        const f = form.getFieldMeta(fieldName);
        const errs = f?.errors;
        if (errs?.length > 0) {
          return fieldName === name;
        }
      } catch {
        // Field might not be registered yet
      }
    }
    return false;
  }, [hasError, name, form, fieldOrder]);

  return (
    <Field
      data-slot="form-field"
      orientation={layout === "row" ? "horizontal" : "vertical"}
      data-invalid={hasError || undefined}
      className={className}
    >
      {label && (
        <FieldLabel className={hasError ? "text-destructive" : undefined}>
          {label}
          {required && (
            <span className="ml-0.5 text-destructive" aria-hidden="true">
              *
            </span>
          )}
        </FieldLabel>
      )}
      <FieldContent>
        <SimpleTooltip
          content={showTooltip ? errorMessages.join(", ") : undefined}
          variant="error"
          side="bottom"
          open={showTooltip || undefined}
        >
          <div
            className={cn(
              "w-full",
              hasError &&
                "[&_.chonk-deboss]:border-destructive [&_.chonk-deboss]:shadow-[inset_0_2px_0_0_var(--destructive)] [&_[data-slot=input]]:border-destructive [&_[data-slot=input]]:shadow-[inset_0_2px_0_0_var(--destructive)]",
            )}
          >
            {children(field)}
          </div>
        </SimpleTooltip>
        {hint && !hasError && <FieldDescription>{hint}</FieldDescription>}
      </FieldContent>
    </Field>
  );
}

// ── FormSubmit ──────────────────────────────────────────────────────

type FormSubmitProps = Omit<React.ComponentProps<typeof Button>, "type">;

function FormSubmit({ className, children, disabled, ...props }: FormSubmitProps) {
  const { form } = useFormContext();

  return (
    <form.Subscribe selector={(state: { isSubmitting: boolean; canSubmit: boolean }) => state}>
      {(state: { isSubmitting: boolean; canSubmit: boolean }) => (
        <Button
          type="submit"
          data-slot="form-submit"
          className={className}
          disabled={disabled || state.isSubmitting || !state.canSubmit}
          {...props}
        >
          {state.isSubmitting ? "Saving..." : children}
        </Button>
      )}
    </form.Subscribe>
  );
}

// ── FormGroup ──────────────────────────────────────────────────────

type FormGroupProps = React.ComponentProps<"fieldset"> & {
  title: React.ReactNode;
};

function FormGroup({ title, className, children, ...props }: FormGroupProps) {
  return (
    <fieldset
      data-slot="form-group"
      className={cn("flex flex-col gap-4 rounded border border-border p-4", className)}
      {...props}
    >
      <legend className="px-2 text-xs font-medium text-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

export { Form, FormField, FormSubmit, FormGroup, useFormContext };
export type { FormProps, FormFieldProps, FormSubmitProps, FormGroupProps };
