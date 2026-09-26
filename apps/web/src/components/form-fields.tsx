import type { FormField, FormSchema } from '@river/forms';
import { formToZod, todayIn } from '@river/forms';
import { useForm } from '@tanstack/react-form';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** 畫面上的欄位值：數字欄位是輸入框裡的字串，送出前由 formToZod 正規化。 */
export type FieldValue = string | string[] | boolean;

export function emptyValue(f: FormField): FieldValue {
  return f.type === 'multiselect' ? [] : f.type === 'checkbox' ? false : '';
}

export function emptyValues(form: FormSchema): Record<string, FieldValue> {
  return Object.fromEntries(form.fields.map((f) => [f.key, emptyValue(f)]));
}

/** 把存下來的資料（正規化後的值）轉回畫面上的欄位值，例如修改後重新送出時預先填好。 */
export function valuesFrom(
  form: FormSchema,
  data: Record<string, unknown>,
): Record<string, FieldValue> {
  return Object.fromEntries(
    form.fields.map((f) => {
      const v = data[f.key];
      if (f.type === 'multiselect')
        return [f.key, Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []];
      if (f.type === 'checkbox') return [f.key, v === true];
      return [f.key, typeof v === 'string' || typeof v === 'number' ? String(v) : ''];
    }),
  );
}

const textareaClass =
  'min-h-[4.5em] w-full resize-y rounded-lg border border-input bg-card px-[0.8em] py-[0.55em] placeholder:text-muted-foreground/80 focus:border-ring focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring)_28%,transparent)] focus:outline-none aria-invalid:border-destructive';

/** 單一欄位的輸入控制項；checkbox 的名稱畫在旁邊，其他類型的名稱由 FieldLabel 負責。 */
export function FieldInput({
  id,
  field,
  value,
  onChange,
  onBlur,
  invalid,
  disabled,
}: {
  id: string;
  field: FormField;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  onBlur?: () => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const common = { id, disabled, onBlur, 'aria-invalid': invalid || undefined };
  const text = typeof value === 'string' ? value : '';
  switch (field.type) {
    case 'text':
      return <Input {...common} value={text} onChange={(e) => onChange(e.target.value)} />;
    case 'textarea':
      return (
        <textarea
          {...common}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          className={textareaClass}
        />
      );
    case 'number':
    case 'money':
      return (
        <div className="relative">
          {field.type === 'money' && (
            <span className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-[0.8em] text-muted-foreground">
              NT$
            </span>
          )}
          <Input
            {...common}
            inputMode="decimal"
            value={text}
            onChange={(e) => onChange(e.target.value)}
            className={cn('font-mono', field.type === 'money' && 'pl-[3.2em]')}
          />
        </div>
      );
    case 'date':
      return (
        <Input {...common} type="date" value={text} onChange={(e) => onChange(e.target.value)} />
      );
    case 'radio':
    case 'multiselect': {
      const multi = field.type === 'multiselect';
      const selected = multi ? (Array.isArray(value) ? value : []) : [text];
      return (
        <div
          id={id}
          role={multi ? 'group' : 'radiogroup'}
          aria-invalid={invalid || undefined}
          className="flex flex-wrap gap-1.5"
        >
          {(field.options ?? []).map((option) => (
            <label
              key={option}
              className={cn(
                'flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5',
                selected.includes(option) && 'border-primary bg-accent',
                disabled && 'cursor-default opacity-70',
              )}
            >
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={id}
                disabled={disabled}
                onBlur={onBlur}
                checked={selected.includes(option)}
                onChange={(e) =>
                  onChange(
                    multi
                      ? e.target.checked
                        ? [...selected, option]
                        : selected.filter((x) => x !== option)
                      : option,
                  )
                }
              />
              {option}
            </label>
          ))}
        </div>
      );
    }
    case 'checkbox':
      return (
        <label className="flex cursor-pointer items-center gap-2">
          <input
            {...common}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          {field.label}
          {field.required && <span className="text-destructive">*</span>}
        </label>
      );
  }
}

export function FieldLabel({ field, htmlFor }: { field: FormField; htmlFor?: string }) {
  if (field.type === 'checkbox') return null;
  return (
    <label htmlFor={htmlFor} className="font-medium text-[0.92em]">
      {field.label || <span className="text-muted-foreground">（未命名）</span>}
      {field.required && <span className="ml-0.5 text-destructive">*</span>}
    </label>
  );
}

function issueMessage(errors: unknown[]): string | undefined {
  const first = errors[0];
  if (!first) return undefined;
  if (typeof first === 'string') return first;
  return (first as { message?: string }).message;
}

type FormValues = { title: string; data: Record<string, FieldValue> };

export interface FormRunnerValues {
  title: string;
  data: Record<string, unknown>;
}

/**
 * 填寫 Form：TanStack Form，驗證用 formToZod 產生的 Zod（和 API 同一份）。
 * 離開欄位時驗證、送出時驗證全部；送出的是正規化後的資料。
 * withTitle 時多一個 Request 標題欄位，和表單一起驗證。
 */
export function FormRunner({
  form,
  withTitle,
  submitLabel,
  pending,
  serverErrors,
  error,
  onSubmit,
  onInvalid,
  actions,
  initial,
}: {
  form: FormSchema | null;
  withTitle?: { placeholder: string };
  /** 預先填好的標題與資料（存下來的值）；沒有時從空白開始。 */
  initial?: { title: string; data: Record<string, unknown> };
  submitLabel: string;
  pending?: boolean;
  /** API 回 422 時各欄位的錯誤（鍵是欄位代碼）。 */
  serverErrors?: Record<string, string>;
  error?: ReactNode;
  onSubmit: (values: FormRunnerValues) => void;
  /** 送出時沒有通過驗證；帶著畫面上的原始值。 */
  onInvalid?: (data: Record<string, unknown>) => void;
  actions?: ReactNode;
}) {
  const dataSchema = form ? formToZod(form, { today: todayIn() }) : z.object({});
  const schema = z.object({
    title: withTitle ? z.string().trim().min(1, '必填').max(200, '最多 200 個字') : z.string(),
    data: dataSchema,
  });
  // formToZod 接受任何輸入（畫面上的字串也可以），這裡只是讓 TanStack Form 知道輸入就是表單值。
  const validator = schema as unknown as z.ZodType<unknown, FormValues>;
  const f = useForm({
    defaultValues: {
      title: initial?.title ?? '',
      data: form ? (initial ? valuesFrom(form, initial.data) : emptyValues(form)) : {},
    } as FormValues,
    validators: { onBlur: validator, onSubmit: validator },
    // 欄位 blur 時只更新那個欄位的錯誤；送出時一定要跑一次完整驗證，把所有欄位的錯誤都標出來。
    // 驗證不過時 onSubmit 仍然不會被呼叫。
    canSubmitWhenInvalid: true,
    onSubmit: ({ value }) => {
      const parsed = schema.parse(value);
      onSubmit({ title: parsed.title, data: parsed.data as Record<string, unknown> });
    },
    onSubmitInvalid: ({ value }) => onInvalid?.(value.data),
  });

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void f.handleSubmit();
      }}
      className="grid gap-4"
    >
      {withTitle && (
        <f.Field name="title">
          {(field) => {
            const message = field.state.meta.isTouched
              ? issueMessage(field.state.meta.errors)
              : undefined;
            return (
              <div className="grid gap-1.5">
                <label htmlFor="request-title" className="font-medium text-[0.92em]">
                  標題<span className="ml-0.5 text-destructive">*</span>
                </label>
                <Input
                  id="request-title"
                  value={field.state.value}
                  maxLength={200}
                  aria-invalid={!!message || undefined}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder={withTitle.placeholder}
                />
                {message && <p className="text-[0.85em] text-destructive">{message}</p>}
              </div>
            );
          }}
        </f.Field>
      )}
      {form?.fields.map((formField) => (
        <f.Field key={formField.id} name={`data.${formField.key}`}>
          {(field) => {
            const id = `field-${formField.id}`;
            const message =
              (field.state.meta.isTouched ? issueMessage(field.state.meta.errors) : undefined) ??
              serverErrors?.[formField.key];
            return (
              <div className="grid content-start gap-1.5">
                <FieldLabel field={formField} htmlFor={id} />
                <FieldInput
                  id={id}
                  field={formField}
                  value={(field.state.value as FieldValue | undefined) ?? emptyValue(formField)}
                  invalid={!!message}
                  onBlur={field.handleBlur}
                  onChange={(v) => field.handleChange(v as never)}
                />
                {message ? (
                  <p className="text-[0.85em] text-destructive">{message}</p>
                ) : (
                  formField.help && (
                    <p className="text-[0.85em] text-muted-foreground">{formField.help}</p>
                  )
                )}
              </div>
            );
          }}
        </f.Field>
      ))}
      {form && form.fields.length === 0 && (
        <p className="text-muted-foreground">這份 Form 還沒有欄位。</p>
      )}
      {error}
      <f.Subscribe
        selector={(s) =>
          [
            s.submissionAttempts,
            Object.values(s.fieldMeta).filter((m) => m && m.errors.length > 0).length,
          ] as const
        }
      >
        {([attempts, invalid]) => (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {attempts > 0 && invalid > 0 && (
              <span className="text-[0.88em] text-destructive">有 {invalid} 個欄位需要修正</span>
            )}
            {actions}
            <Button type="submit" disabled={pending}>
              {pending ? '送出中…' : submitLabel}
            </Button>
          </div>
        )}
      </f.Subscribe>
    </form>
  );
}

/** 唯讀顯示某一步填寫的資料。 */
export function FormDataView({ form, data }: { form: FormSchema; data: Record<string, unknown> }) {
  return (
    <dl className="grid grid-cols-[minmax(6em,max-content)_1fr] gap-x-4 gap-y-1.5 text-[0.95em]">
      {form.fields.map((f) => (
        <div key={f.id} className="contents">
          <dt className="text-muted-foreground">{f.label}</dt>
          <dd
            className={cn(
              'min-w-0 whitespace-pre-wrap break-words',
              (f.type === 'number' || f.type === 'money') && 'font-mono',
            )}
          >
            {displayValue(f, data[f.key])}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const money = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 });

export function displayValue(f: FormField, v: unknown): string {
  if (f.type === 'checkbox') return v === true ? '是' : '否';
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) return '—';
  if (Array.isArray(v)) return v.join('、');
  if (f.type === 'money' && typeof v === 'number') return `NT$ ${money.format(v)}`;
  return String(v);
}
