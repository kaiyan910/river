import type { AttachmentRef, FormField, FormSchema, TableColumn } from '@river/forms';
import { formToZod, TABLE_MAX_ROWS, todayIn } from '@river/forms';
import { useForm } from '@tanstack/react-form';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Search, Trash2, X } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useDeferredValue,
  useId,
  useMemo,
  useState,
} from 'react';
import { z } from 'zod';
import { AttachmentInput, AttachmentList, attachmentsFrom } from '@/components/attachment-field';
import { Avatar } from '@/components/people';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { personSearchQueryOptions } from '@/lib/org';
import { cn } from '@/lib/utils';

/**
 * 畫面上的欄位值：數字欄位是輸入框裡的字串，人員選擇器是 Participant ID，明細表是每一行的欄位值，
 * 附件欄位是已上傳的附件；送出前由 formToZod 正規化。
 */
export type FieldValue = CellValue | FieldRow[] | AttachmentRef[];
/** 明細表一格的值；明細表不能巢狀（也不能放附件），所以只有一層。 */
export type CellValue = string | string[] | boolean;
export type FieldRow = Record<string, CellValue>;

export function emptyValue(f: FormField | TableColumn): FieldValue {
  return f.type === 'multiselect' || f.type === 'table' || f.type === 'attachment'
    ? []
    : f.type === 'checkbox'
      ? false
      : '';
}

export function emptyValues(form: FormSchema): Record<string, FieldValue> {
  return Object.fromEntries(form.fields.map((f) => [f.key, emptyValue(f)]));
}

/** 明細表新增的一行：每一欄都是空值。 */
export function emptyRow(f: FormField): FieldRow {
  return Object.fromEntries((f.columns ?? []).map((c) => [c.key, emptyValue(c) as CellValue]));
}

/** 把存下來的一個值（正規化後）轉回畫面上的欄位值。 */
function valueFrom(f: FormField | TableColumn, v: unknown): FieldValue {
  if (f.type === 'multiselect')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  if (f.type === 'checkbox') return v === true;
  if (f.type === 'attachment') return attachmentsFrom(v);
  if (f.type === 'table') {
    const columns = 'columns' in f ? (f.columns ?? []) : [];
    return Array.isArray(v)
      ? v.map((row: unknown) => {
          const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
          return Object.fromEntries(
            columns.map((c) => [c.key, valueFrom(c, r[c.key]) as CellValue]),
          );
        })
      : [];
  }
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

/** 把存下來的資料（正規化後的值）轉回畫面上的欄位值，例如修改後重新送出時預先填好。 */
export function valuesFrom(
  form: FormSchema,
  data: Record<string, unknown>,
): Record<string, FieldValue> {
  return Object.fromEntries(form.fields.map((f) => [f.key, valueFrom(f, data[f.key])]));
}

// ─── 人員選擇器 ─────────────────────────────────────────────────────────

interface PersonName {
  id: string;
  name: string;
}

/**
 * 人員選擇器選到的人的姓名。Form 資料只存 Participant ID，姓名來自 API 回傳的明細（people），
 * 或是在這個畫面上搜尋、選到時記下來的。
 */
const PeopleNamesContext = createContext<{
  names: ReadonlyMap<string, string>;
  remember: (person: PersonName) => void;
} | null>(null);

/** 讓底下的填寫與唯讀顯示共用姓名（例如表單設計器的即時預覽）。 */
export function PeopleNamesProvider({
  people = [],
  children,
}: {
  people?: PersonName[];
  children: ReactNode;
}) {
  const [names, setNames] = useState(() => new Map(people.map((p) => [p.id, p.name])));
  const remember = useCallback(
    (p: PersonName) => setNames((m) => (m.get(p.id) === p.name ? m : new Map(m).set(p.id, p.name))),
    [],
  );
  const value = useMemo(() => ({ names, remember }), [names, remember]);
  return <PeopleNamesContext.Provider value={value}>{children}</PeopleNamesContext.Provider>;
}

/** 選到的人以唯讀方式顯示姓名；搜尋啟用中的 Participant 來更換。 */
function PersonInput({
  id,
  value,
  onChange,
  onBlur,
  invalid,
  disabled,
  label,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  invalid?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const ctx = useContext(PeopleNamesContext);
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query.trim());
  const listId = useId();
  const results = useQuery({
    ...personSearchQueryOptions(q),
    enabled: !!q && !disabled,
    placeholderData: keepPreviousData,
  });

  if (value) {
    const name = ctx?.names.get(value);
    return (
      <div
        id={id}
        aria-invalid={invalid || undefined}
        className="flex min-h-[2.3em] items-center gap-2 rounded-lg border border-input bg-card px-2 py-1 aria-invalid:border-destructive"
      >
        <Avatar id={value} name={name ?? '?'} size={22} />
        <span className="min-w-0 flex-1 truncate">
          {name ?? <span className="font-mono text-muted-foreground">{value.slice(0, 8)}</span>}
        </span>
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange('')}
            onBlur={onBlur}
            aria-label={`清除${label ? `「${label}」` : ''}選到的人`}
            className="grid cursor-pointer place-items-center rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X size={14} />
          </button>
        )}
      </div>
    );
  }

  const matches = q ? (results.data ?? []) : [];
  return (
    <div className="relative grid gap-1">
      <div className="relative">
        <Search
          size={14}
          aria-hidden
          className="-translate-y-1/2 absolute top-1/2 left-[0.7em] text-muted-foreground"
        />
        <Input
          id={id}
          type="search"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={onBlur}
          placeholder="搜尋姓名或 email"
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-controls={listId}
          autoComplete="off"
          className="pl-[2.1em]"
        />
      </div>
      {q && (
        <ul
          id={listId}
          className="absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-auto rounded-lg border bg-card shadow-md"
        >
          {results.isError && (
            <li className="px-3 py-2 text-destructive">搜尋失敗，請稍後再試。</li>
          )}
          {!results.isError && matches.length === 0 && (
            <li className="px-3 py-2 text-muted-foreground">
              {results.isFetching ? '搜尋中…' : '找不到符合的人。'}
            </li>
          )}
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                // 用 mousedown 選取，避免輸入框先 blur 造成清單消失前就觸發驗證。
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  ctx?.remember(p);
                  onChange(p.id);
                  setQuery('');
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left hover:bg-accent"
              >
                <Avatar id={p.id} name={p.name} size={22} />
                <span>{p.name}</span>
                <span className="truncate text-[0.86em] text-muted-foreground">{p.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
  ariaLabel,
}: {
  id: string;
  field: FormField | TableColumn;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  onBlur?: () => void;
  invalid?: boolean;
  disabled?: boolean;
  /** 沒有 FieldLabel 時（例如明細表的一格）給輔助技術的名稱。 */
  ariaLabel?: string;
}) {
  const common = {
    id,
    disabled,
    onBlur,
    'aria-invalid': invalid || undefined,
    'aria-label': ariaLabel,
  };
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
      const selected: string[] = multi
        ? Array.isArray(value)
          ? value.filter((x): x is string => typeof x === 'string')
          : []
        : [text];
      return (
        <div
          id={id}
          role={multi ? 'group' : 'radiogroup'}
          {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
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
          {!ariaLabel && field.label}
          {!ariaLabel && field.required && <span className="text-destructive">*</span>}
        </label>
      );
    case 'person':
      return (
        <PersonInput
          id={id}
          value={text}
          onChange={onChange}
          onBlur={onBlur}
          invalid={invalid}
          disabled={disabled}
          label={ariaLabel ?? field.label}
        />
      );
    case 'table':
      // 明細表有自己的新增、刪除行，由 FormRunner 的 TableField 處理。
      return null;
    case 'attachment':
      return (
        <AttachmentInput
          id={id}
          field={field}
          value={attachmentsFrom(value)}
          onChange={onChange}
          onBlur={onBlur}
          invalid={invalid}
          disabled={disabled}
        />
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
  people,
}: {
  form: FormSchema | null;
  withTitle?: { placeholder: string };
  /** 預先填好的標題與資料（存下來的值）；沒有時從空白開始。 */
  initial?: { title: string; data: Record<string, unknown> };
  submitLabel: string;
  pending?: boolean;
  /** API 回 422 時各欄位的錯誤（鍵是欄位代碼；明細表的一格是 items[0].amount）。 */
  serverErrors?: Record<string, string>;
  error?: ReactNode;
  onSubmit: (values: FormRunnerValues) => void;
  /** 送出時沒有通過驗證；帶著畫面上的原始值。 */
  onInvalid?: (data: Record<string, unknown>) => void;
  actions?: ReactNode;
  /** 預先填好的資料裡人員選擇器選到的人（明細的 people），用來顯示姓名。 */
  people?: PersonName[];
}) {
  const outerNames = useContext(PeopleNamesContext);
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

  const content = (
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
      {form?.fields.map((formField) =>
        formField.type === 'table' ? (
          <f.Field key={formField.id} name={`data.${formField.key}`} mode="array">
            {(table) => {
              const rows = Array.isArray(table.state.value)
                ? (table.state.value as FieldRow[])
                : [];
              const columns = formField.columns ?? [];
              const message =
                (table.state.meta.isTouched || table.state.meta.isDirty
                  ? issueMessage(table.state.meta.errors)
                  : undefined) ?? serverErrors?.[formField.key];
              return (
                <div className="grid content-start gap-1.5">
                  <FieldLabel field={formField} />
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-max text-[0.92em]">
                      <thead className="bg-muted/50 text-[0.88em] text-muted-foreground">
                        <tr>
                          <th className="w-8 px-2 py-1.5 text-right font-normal">#</th>
                          {columns.map((c) => (
                            <th key={c.id} className="px-2 py-1.5 text-left font-normal">
                              {c.label}
                              {c.required && <span className="ml-0.5 text-destructive">*</span>}
                            </th>
                          ))}
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((_, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: 行沒有 ID，TanStack Form 的 array field 以位置對應
                          <tr key={i} className="border-t align-top">
                            <td className="px-2 py-2.5 text-right font-mono text-muted-foreground">
                              {i + 1}
                            </td>
                            {columns.map((c) => (
                              <f.Field key={c.id} name={`data.${formField.key}[${i}].${c.key}`}>
                                {(cell) => {
                                  const path = `${formField.key}[${i}].${c.key}`;
                                  const cellMessage =
                                    (cell.state.meta.isTouched
                                      ? issueMessage(cell.state.meta.errors)
                                      : undefined) ?? serverErrors?.[path];
                                  return (
                                    <td className="min-w-[9em] px-1.5 py-1.5">
                                      <FieldInput
                                        id={`field-${formField.id}-${i}-${c.id}`}
                                        field={c}
                                        ariaLabel={`${formField.label}第 ${i + 1} 行的${c.label}`}
                                        value={
                                          (cell.state.value as FieldValue | undefined) ??
                                          emptyValue(c)
                                        }
                                        invalid={!!cellMessage}
                                        onBlur={cell.handleBlur}
                                        onChange={(v) => cell.handleChange(v as never)}
                                      />
                                      {cellMessage && (
                                        <p className="mt-1 text-[0.85em] text-destructive">
                                          {cellMessage}
                                        </p>
                                      )}
                                    </td>
                                  );
                                }}
                              </f.Field>
                            ))}
                            <td className="px-1 py-2">
                              <button
                                type="button"
                                onClick={() => table.removeValue(i)}
                                aria-label={`刪除第 ${i + 1} 行`}
                                className="grid cursor-pointer place-items-center rounded p-1 text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {rows.length === 0 && (
                          <tr className="border-t">
                            <td
                              colSpan={columns.length + 2}
                              className="px-3 py-3 text-center text-muted-foreground"
                            >
                              還沒有任何一行。
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={rows.length >= TABLE_MAX_ROWS}
                      onClick={() => table.pushValue(emptyRow(formField) as never)}
                    >
                      <Plus size={14} aria-hidden /> 新增一行
                    </Button>
                    {message ? (
                      <p className="text-[0.85em] text-destructive">{message}</p>
                    ) : (
                      formField.help && (
                        <p className="text-[0.85em] text-muted-foreground">{formField.help}</p>
                      )
                    )}
                  </div>
                </div>
              );
            }}
          </f.Field>
        ) : (
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
        ),
      )}
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
  // 已經在 PeopleNamesProvider 裡（例如即時預覽）時共用外層的姓名，否則自己記。
  return outerNames ? (
    content
  ) : (
    <PeopleNamesProvider people={people}>{content}</PeopleNamesProvider>
  );
}

/** 唯讀顯示某一步填寫的資料；人員選擇器顯示姓名（people 是明細帶的，或外層 PeopleNamesProvider 記下的）。 */
export function FormDataView({
  form,
  data,
  people = [],
}: {
  form: FormSchema;
  data: Record<string, unknown>;
  people?: PersonName[];
}) {
  const ctx = useContext(PeopleNamesContext);
  const known = new Map(people.map((p) => [p.id, p.name]));
  const nameOf = (id: string) => known.get(id) ?? ctx?.names.get(id);
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
            {f.type === 'table' ? (
              <TableView field={f} value={data[f.key]} nameOf={nameOf} />
            ) : f.type === 'attachment' && attachmentsFrom(data[f.key]).length > 0 ? (
              <AttachmentList files={attachmentsFrom(data[f.key])} />
            ) : (
              displayValue(f, data[f.key], nameOf)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const money = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 });

/** 唯讀顯示明細表：每一行一列。 */
function TableView({
  field,
  value,
  nameOf,
}: {
  field: FormField;
  value: unknown;
  nameOf: (id: string) => string | undefined;
}) {
  const rows = Array.isArray(value) ? value : [];
  const columns = field.columns ?? [];
  if (rows.length === 0) return '—';
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-max text-[0.95em]">
        <thead className="bg-muted/50 text-[0.88em] text-muted-foreground">
          <tr>
            <th className="w-8 px-2 py-1 text-right font-normal">#</th>
            {columns.map((c) => (
              <th key={c.id} className="px-2 py-1 text-left font-normal">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row: unknown, i) => {
            const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: 存下來的行沒有 ID，順序就是它的識別
              <tr key={i} className="border-t">
                <td className="px-2 py-1 text-right font-mono text-muted-foreground">{i + 1}</td>
                {columns.map((c) => (
                  <td
                    key={c.id}
                    className={cn(
                      'px-2 py-1',
                      (c.type === 'number' || c.type === 'money') && 'text-right font-mono',
                    )}
                  >
                    {displayValue(c, r[c.key], nameOf)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function displayValue(
  f: FormField | TableColumn,
  v: unknown,
  nameOf: (id: string) => string | undefined = () => undefined,
): string {
  if (f.type === 'checkbox') return v === true ? '是' : '否';
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) return '—';
  if (f.type === 'attachment')
    return (
      attachmentsFrom(v)
        .map((a) => a.name)
        .join('、') || '—'
    );
  if (f.type === 'person' && typeof v === 'string') return nameOf(v) ?? '（不明的人員）';
  if (f.type === 'table' && Array.isArray(v)) return `${v.length} 行`;
  if (Array.isArray(v)) return v.join('、');
  if (f.type === 'money' && typeof v === 'number') return `NT$ ${money.format(v)}`;
  return String(v);
}
