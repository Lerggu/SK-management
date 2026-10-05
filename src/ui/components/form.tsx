"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Label } from "@/ui/components/label";
import { Textarea } from "@/ui/components/textarea";
import { cn } from "@/ui/lib/utils";

export interface FormState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
}

type Action = (state: FormState | null, formData: FormData) => Promise<FormState>;

const FormStateContext = React.createContext<FormState | null>(null);

/** Server-action form with field errors and preserved input. */
export function ActionForm({
  action,
  children,
  className,
  showSuccess = false,
  ...rest
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  showSuccess?: boolean;
} & Omit<React.ComponentProps<"form">, "action" | "children">) {
  const [state, formAction] = useActionState(action, null);
  const t = useTranslations();
  return (
    <FormStateContext.Provider value={state}>
      <form action={formAction} className={cn("space-y-4", className)} noValidate {...rest}>
        {state && !state.ok && state.message && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.fieldErrors?._form?.length ? state.fieldErrors._form.map((e) => t(e)).join(" ") : t(state.message)}
          </p>
        )}
        {state?.ok && showSuccess && state.message && (
          <p role="status" className="rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-800">
            {t(state.message)}
          </p>
        )}
        {children}
      </form>
    </FormStateContext.Provider>
  );
}

function useField(name: string, defaultValue?: string | number | null) {
  const state = React.useContext(FormStateContext);
  const t = useTranslations();
  const errors = state?.fieldErrors?.[name] ?? [];
  const value = state?.values && name in state.values ? state.values[name] : (defaultValue ?? "");
  // Re-mount inputs when the server echoes values so defaults apply.
  const key = state?.values ? `${name}:${JSON.stringify(state.values[name] ?? "")}` : name;
  return { errors: errors.map((e) => (e.includes(".") ? t(e) : e)), value: String(value), key };
}

function FieldShell({
  id,
  label,
  hint,
  errors,
  required,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  errors: string[];
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && <span aria-hidden className="text-destructive"> *</span>}
      </Label>
      {children}
      {hint && !errors.length && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {errors.map((e) => (
        <p key={e} id={`${id}-error`} className="text-xs font-medium text-destructive">
          {e}
        </p>
      ))}
    </div>
  );
}

export function TextField({
  name,
  label,
  defaultValue,
  hint,
  required,
  className,
  ...input
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  hint?: string;
  required?: boolean;
  className?: string;
} & Omit<React.ComponentProps<"input">, "name" | "defaultValue">) {
  const f = useField(name, defaultValue);
  const id = `f-${name}-${React.useId().replace(/:/g, "")}`;
  return (
    <FieldShell id={id} label={label} hint={hint} errors={f.errors} required={required} className={className}>
      <Input
        key={f.key}
        id={id}
        name={name}
        defaultValue={f.value}
        aria-invalid={f.errors.length > 0 || undefined}
        aria-describedby={f.errors.length ? `${id}-error` : hint ? `${id}-hint` : undefined}
        aria-required={required || undefined}
        {...input}
      />
    </FieldShell>
  );
}

export function TextareaField({
  name,
  label,
  defaultValue,
  hint,
  rows = 3,
  className,
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
  hint?: string;
  rows?: number;
  className?: string;
}) {
  const f = useField(name, defaultValue);
  const id = `f-${name}-${React.useId().replace(/:/g, "")}`;
  return (
    <FieldShell id={id} label={label} hint={hint} errors={f.errors} className={className}>
      <Textarea key={f.key} id={id} name={name} rows={rows} defaultValue={f.value} aria-invalid={f.errors.length > 0 || undefined} />
    </FieldShell>
  );
}

export interface Option {
  value: string;
  label: string;
}

/** Native select: best touch UX on phones and works with plain FormData. */
export function SelectField({
  name,
  label,
  options,
  defaultValue,
  placeholder,
  required,
  hint,
  className,
}: {
  name: string;
  label: string;
  options: Option[];
  defaultValue?: string | null;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  className?: string;
}) {
  const f = useField(name, defaultValue);
  const id = `f-${name}-${React.useId().replace(/:/g, "")}`;
  return (
    <FieldShell id={id} label={label} hint={hint} errors={f.errors} required={required} className={className}>
      <select
        key={f.key}
        id={id}
        name={name}
        defaultValue={f.value}
        aria-invalid={f.errors.length > 0 || undefined}
        className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:h-9 md:text-sm"
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/** Single checkbox with its field error (e.g. an acknowledgement). */
export function CheckboxField({ name, label, className }: { name: string; label: string; className?: string }) {
  const f = useField(name);
  return (
    <div className={cn("space-y-1", className)}>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm md:min-h-9">
        <input type="checkbox" name={name} defaultChecked={f.value === "on"} aria-invalid={f.errors.length > 0 || undefined} className="size-5 accent-primary md:size-4" />
        {label}
      </label>
      {f.errors.map((e) => (
        <p key={e} className="text-xs font-medium text-destructive">
          {e}
        </p>
      ))}
    </div>
  );
}

/** Group of checkboxes submitting the same name (e.g. roleIds). */
export function CheckboxGroupField({
  name,
  label,
  options,
  defaultValues = [],
}: {
  name: string;
  label: string;
  options: Option[];
  defaultValues?: string[];
}) {
  const state = React.useContext(FormStateContext);
  const t = useTranslations();
  const errors = (state?.fieldErrors?.[name] ?? []).map((e) => t(e));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {options.map((o) => (
          <label key={o.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted md:min-h-9">
            <input type="checkbox" name={name} value={o.value} defaultChecked={defaultValues.includes(o.value)} className="size-5 accent-primary md:size-4" />
            <span className="text-sm">{o.label}</span>
          </label>
        ))}
      </div>
      {errors.map((e) => (
        <p key={e} className="text-xs font-medium text-destructive">
          {e}
        </p>
      ))}
    </fieldset>
  );
}

export function FileField({ name = "file", label, hint, accept, required }: { name?: string; label: string; hint?: string; accept?: string; required?: boolean }) {
  const f = useField(name);
  const id = `f-${name}-${React.useId().replace(/:/g, "")}`;
  return (
    <FieldShell id={id} label={label} hint={hint} errors={f.errors} required={required}>
      <input
        id={id}
        name={name}
        type="file"
        accept={accept}
        aria-invalid={f.errors.length > 0 || undefined}
        className="block w-full rounded-lg border border-input bg-background p-2 text-base file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:text-sm file:font-medium md:text-sm"
      />
    </FieldShell>
  );
}

export function SubmitButton({ children, variant, className }: { children: React.ReactNode; variant?: React.ComponentProps<typeof Button>["variant"]; className?: string }) {
  const { pending } = useFormStatus();
  const t = useTranslations("common");
  return (
    <Button type="submit" disabled={pending} variant={variant} className={cn("w-full sm:w-auto", className)}>
      {pending ? t("submitting") : children}
    </Button>
  );
}

/** Small form posting a single action (archive, approve…), with optional confirm. */
export function ActionButton({
  action,
  children,
  confirm,
  variant = "outline",
  hidden,
  className,
}: {
  action: Action;
  children: React.ReactNode;
  confirm?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  hidden?: Record<string, string>;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const t = useTranslations();
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={cn("inline-flex flex-col gap-1", className)}
    >
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <SubmitButton variant={variant}>{children}</SubmitButton>
      {state && !state.ok && state.message && (
        <span role="alert" className="text-xs text-destructive">
          {state.fieldErrors?._form?.length ? state.fieldErrors._form.map((e) => t(e)).join(" ") : t(state.message)}
        </span>
      )}
    </form>
  );
}
