import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { type DslError, NODE_TYPE_LABELS, type NodeType } from '@river/dsl';
import {
  ATTACHMENT_MAX_FILES,
  ATTACHMENT_MAX_SIZE_MB,
  FIELD_KEY_PATTERN,
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  type FieldRules,
  type FieldType,
  type FormField,
  type FormSchema,
  normalizeAccept,
  TABLE_COLUMN_TYPES,
  TABLE_MAX_COLUMNS,
  type TableColumn,
  todayIn,
  validateFormData,
} from '@river/forms';
import {
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  CircleDot,
  GripVertical,
  Hash,
  ListChecks,
  Paperclip,
  Plus,
  Table2,
  Text,
  TextCursorInput,
  Trash2,
  UserRound,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { AttachmentTransportProvider, previewTransport } from '@/components/attachment-field';
import { FormDataView, FormRunner, PeopleNamesProvider } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export const FIELD_ICONS: Record<FieldType, typeof Text> = {
  text: TextCursorInput,
  textarea: Text,
  number: Hash,
  money: CircleDollarSign,
  date: Calendar,
  radio: CircleDot,
  multiselect: ListChecks,
  checkbox: CheckSquare,
  attachment: Paperclip,
  person: UserRound,
  table: Table2,
};

/** 可以指定 Form 的節點（開始、填表）。 */
export interface FormSlot {
  id: string;
  type: Extract<NodeType, 'start' | 'form'>;
  name: string;
  formId: string | null;
}

const shortId = () => crypto.randomUUID().slice(0, 8);

export function newForm(existing: FormSchema[]): FormSchema {
  const taken = new Set(existing.map((f) => f.name));
  let n = existing.length + 1;
  while (taken.has(`新的 Form ${n}`)) n++;
  return { id: `form-${shortId()}`, name: `新的 Form ${n}`, fields: [] };
}

const DEFAULT_OPTIONS = ['選項 1', '選項 2'];

function newField(type: FieldType, form: FormSchema): FormField {
  const keys = new Set(form.fields.map((f) => f.key));
  let n = form.fields.length + 1;
  while (keys.has(`field_${n}`)) n++;
  return {
    id: `field-${shortId()}`,
    key: `field_${n}`,
    type,
    label: `新的${FIELD_TYPE_LABELS[type]}`,
    required: false,
    rules: {},
    options: type === 'radio' || type === 'multiselect' ? DEFAULT_OPTIONS : undefined,
    // 明細表先放兩欄（例如報銷的項目與金額），Designer 再調整。
    columns:
      type === 'table'
        ? [
            newColumn('text', [], { key: 'item', label: '項目', required: true }),
            newColumn('money', [], { key: 'amount', label: '金額', required: true }),
          ]
        : undefined,
  };
}

function newColumn(
  type: TableColumn['type'],
  columns: TableColumn[],
  extra: Partial<TableColumn> = {},
): TableColumn {
  const keys = new Set(columns.map((c) => c.key));
  let n = columns.length + 1;
  while (keys.has(`col_${n}`)) n++;
  return {
    id: `col-${shortId()}`,
    key: `col_${n}`,
    type,
    label: `新的${FIELD_TYPE_LABELS[type]}`,
    required: false,
    rules: {},
    options: type === 'radio' || type === 'multiselect' ? DEFAULT_OPTIONS : undefined,
    ...extra,
  };
}

/** 規則的白話摘要，顯示在欄位表格上。 */
export function describeRules(f: FormField | TableColumn): string[] {
  const r = f.rules;
  const out: string[] = [];
  if (r.minLength) out.push(`≥ ${r.minLength} 字`);
  if (r.maxLength) out.push(`≤ ${r.maxLength} 字`);
  if (r.pattern) out.push(`格式 ${r.pattern}`);
  if (r.min !== undefined) out.push(`≥ ${r.min.toLocaleString()}`);
  if (r.max !== undefined) out.push(`≤ ${r.max.toLocaleString()}`);
  if (r.notPast) out.push('不早於今天');
  if (r.maxSelected) out.push(`最多選 ${r.maxSelected} 項`);
  if (f.type === 'attachment') {
    if (r.accept?.length) out.push(r.accept.join(' '));
    if (r.maxSizeMb) out.push(`每個 ≤ ${r.maxSizeMb} MB`);
    if (r.maxFiles) out.push(`最多 ${r.maxFiles} 個`);
  }
  if (f.type === 'radio' || f.type === 'multiselect')
    out.push(`${(f.options ?? []).filter(Boolean).length} 個選項`);
  if ('columns' in f && f.type === 'table') out.push(`${(f.columns ?? []).length} 欄`);
  return out;
}

/**
 * 一份 Form 的分頁（C「欄位表格 + 即時預覽」）：左半是欄位表格，右半是一直開著的即時預覽。
 * 上方勾選這份 Form 用在哪些開始／填表節點。
 */
export function FormSheet({
  form,
  slots,
  forms,
  errors,
  onChange,
  onAssign,
  onDelete,
}: {
  form: FormSchema;
  slots: FormSlot[];
  forms: FormSchema[];
  errors: DslError[];
  onChange: (form: FormSchema) => void;
  onAssign: (nodeId: string, formId: string | null) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const usedBy = slots.filter((s) => s.formId === form.id);

  const patchField = (id: string, patch: Partial<FormField>) =>
    onChange({ ...form, fields: form.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) });

  function onDragEnd(e: DragEndEvent) {
    const from = form.fields.findIndex((f) => f.id === e.active.id);
    const to = form.fields.findIndex((f) => f.id === e.over?.id);
    if (from >= 0 && to >= 0 && from !== to)
      onChange({ ...form, fields: arrayMove(form.fields, from, to) });
  }

  function assign(slot: FormSlot, checked: boolean) {
    if (checked && slot.formId && slot.formId !== form.id) {
      const current = forms.find((f) => f.id === slot.formId)?.name ?? '另一份 Form';
      if (!window.confirm(`「${slot.name}」目前用「${current}」，要改成「${form.name}」嗎？`))
        return;
    }
    onAssign(slot.id, checked ? form.id : null);
  }

  function remove() {
    const message = usedBy.length
      ? `「${form.name}」用在 ${usedBy.map((u) => `「${u.name}」`).join('、')}，刪除後這些節點會變成沒有指定 Form。確定要刪除嗎？`
      : `確定要刪除「${form.name}」嗎？`;
    if (window.confirm(message)) onDelete();
  }

  const formErrors = errors.filter((e) => !e.fieldId);

  return (
    <div className="grid min-h-0 flex-1 overflow-auto lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:overflow-hidden">
      <div className="flex min-h-0 flex-col bg-card lg:overflow-auto lg:border-r">
        <div className="grid gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              aria-label="Form 名稱"
              value={form.name}
              maxLength={100}
              onChange={(e) => onChange({ ...form, name: e.target.value })}
              className="min-w-0 flex-1 rounded-md bg-transparent px-1 font-semibold text-[1.1em] hover:bg-muted focus:bg-muted focus:outline-none"
            />
            <Button size="sm" variant="ghost" className="text-destructive" onClick={remove}>
              <Trash2 size={14} aria-hidden /> 刪除 Form
            </Button>
          </div>
          <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.9em]">
            <legend className="float-left mr-1 text-muted-foreground">用在：</legend>
            {slots.length === 0 && (
              <span className="text-muted-foreground">流程裡還沒有開始或填表節點。</span>
            )}
            {slots.map((slot) => (
              <label key={slot.id} className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={slot.formId === form.id}
                  onChange={(e) => assign(slot, e.target.checked)}
                />
                {NODE_TYPE_LABELS[slot.type]}「{slot.name}」
                {slot.formId && slot.formId !== form.id && (
                  <span className="text-[0.85em] text-muted-foreground">
                    （目前用 {forms.find((f) => f.id === slot.formId)?.name ?? '已刪除的 Form'}）
                  </span>
                )}
              </label>
            ))}
          </fieldset>
        </div>

        <div
          aria-hidden
          className="grid grid-cols-[24px_28px_minmax(0,1.3fr)_minmax(0,1fr)_40px_minmax(0,1.2fr)_28px] items-center gap-x-2 border-b bg-muted/50 px-3 py-1.5 text-[0.8em] text-muted-foreground"
        >
          <span />
          <span />
          <span>欄位名稱</span>
          <span>欄位代碼</span>
          <span className="text-center">必填</span>
          <span>規則</span>
          <span />
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={form.fields.map((f) => f.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul aria-label="欄位">
              {form.fields.map((f) => (
                <FieldRow
                  key={f.id}
                  field={f}
                  open={open === f.id}
                  errors={errors
                    .filter(
                      (e) =>
                        e.fieldId === f.id || (f.columns ?? []).some((c) => c.id === e.fieldId),
                    )
                    .map((e) => e.message)}
                  onToggle={() => setOpen(open === f.id ? null : f.id)}
                  onChange={(patch) => patchField(f.id, patch)}
                  onRemove={() =>
                    onChange({ ...form, fields: form.fields.filter((x) => x.id !== f.id) })
                  }
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        {form.fields.length === 0 && (
          <p className="px-4 py-6 text-center text-muted-foreground">
            還沒有欄位，從下方「新增欄位」開始。
          </p>
        )}
        <div className="relative px-3 py-2">
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={adding}
            onClick={() => setAdding((v) => !v)}
          >
            <Plus size={14} aria-hidden /> 新增欄位 <ChevronDown size={13} aria-hidden />
          </Button>
          {adding && (
            <div className="absolute top-full left-3 z-10 grid w-60 grid-cols-2 gap-0.5 rounded-lg border bg-card p-1 shadow-md">
              {FIELD_TYPES.map((t) => {
                const Icon = FIELD_ICONS[t];
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      const field = newField(t, form);
                      onChange({ ...form, fields: [...form.fields, field] });
                      setOpen(field.id);
                      setAdding(false);
                    }}
                    className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                  >
                    <Icon size={14} className="text-muted-foreground" aria-hidden />
                    {FIELD_TYPE_LABELS[t]}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {formErrors.length > 0 && (
          <ul className="mx-3 mb-3 grid gap-1 rounded-lg bg-destructive/8 p-2.5 text-[0.88em] text-destructive">
            {formErrors.map((e) => (
              <li key={e.code} className="flex items-center gap-1.5">
                <CircleAlert size={13} aria-hidden className="shrink-0" /> {e.message}
              </li>
            ))}
          </ul>
        )}
        {usedBy.length === 0 && (
          <p className="mx-3 mb-3 text-[0.85em] text-muted-foreground">
            沒有節點使用這份 Form，發佈前不會檢查它。
          </p>
        )}
      </div>
      <LivePreview form={form} />
    </div>
  );
}

const GRID =
  'grid grid-cols-[24px_28px_minmax(0,1.3fr)_minmax(0,1fr)_40px_minmax(0,1.2fr)_28px] items-center gap-x-2';

function FieldRow({
  field,
  open,
  errors,
  onToggle,
  onChange,
  onRemove,
}: {
  field: FormField;
  open: boolean;
  errors: string[];
  onToggle: () => void;
  onChange: (patch: Partial<FormField>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
  });
  const Icon = FIELD_ICONS[field.type];
  const rules = describeRules(field);
  const invalid = errors.length > 0;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'border-b bg-card',
        isDragging && 'relative z-10 shadow-lg',
        open && 'bg-accent/30',
      )}
    >
      <div className={cn(GRID, 'px-3 py-1')}>
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`拖拉排序「${field.label}」`}
          className="grid cursor-grab place-items-center text-muted-foreground"
        >
          <GripVertical size={15} />
        </button>
        <span
          title={FIELD_TYPE_LABELS[field.type]}
          className={cn(
            'grid size-7 place-items-center rounded-md bg-muted text-muted-foreground',
            invalid && 'bg-destructive/10 text-destructive',
          )}
        >
          <Icon size={14} aria-hidden />
        </span>
        <input
          value={field.label}
          maxLength={100}
          onChange={(e) => onChange({ label: e.target.value })}
          aria-label="欄位名稱"
          aria-invalid={!field.label.trim() || undefined}
          className="h-8 min-w-0 rounded-md border border-transparent bg-transparent px-1.5 hover:border-border focus:border-ring focus:bg-card focus:outline-none aria-invalid:border-destructive/60"
        />
        <input
          value={field.key}
          maxLength={50}
          onChange={(e) => onChange({ key: e.target.value })}
          aria-label="欄位代碼"
          aria-invalid={!FIELD_KEY_PATTERN.test(field.key) || undefined}
          spellCheck={false}
          className="h-8 min-w-0 rounded-md border border-transparent bg-transparent px-1.5 font-mono text-[0.88em] text-muted-foreground hover:border-border focus:border-ring focus:bg-card focus:outline-none aria-invalid:border-destructive/60"
        />
        <input
          type="checkbox"
          aria-label="必填"
          checked={field.required}
          onChange={(e) => onChange({ required: e.target.checked })}
          className="justify-self-center"
        />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 cursor-pointer items-center gap-1 text-left"
        >
          {open ? (
            <ChevronDown size={13} className="shrink-0" aria-hidden />
          ) : (
            <ChevronRight size={13} className="shrink-0" aria-hidden />
          )}
          <span className="flex min-w-0 flex-wrap gap-1">
            {rules.map((r) => (
              <span
                key={r}
                className="truncate rounded bg-muted px-1.5 text-[0.78em] text-muted-foreground"
              >
                {r}
              </span>
            ))}
            {rules.length === 0 && (
              <span className="text-[0.82em] text-muted-foreground">設定規則</span>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`刪除「${field.label}」`}
          className="grid cursor-pointer place-items-center text-muted-foreground hover:text-destructive"
        >
          <Trash2 size={14} />
        </button>
      </div>
      {invalid && !open && (
        <ul className="px-3 pb-1.5 pl-[70px] text-[0.84em] text-destructive">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {open && (
        <div className="border-t border-dashed px-3 py-3 lg:pl-[70px]">
          <FieldSettings field={field} errors={errors} onChange={onChange} />
        </div>
      )}
    </li>
  );
}

function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: 控制項由 children 傳入，label 直接包住它
    <label className="grid content-start gap-1">
      <span className="text-[0.85em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function NumberSetting({
  label,
  value,
  onChange,
  integer,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  integer?: boolean;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  return (
    <Setting label={label}>
      <Input
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const raw = e.target.value.trim();
          const n = Number(raw);
          if (raw === '') onChange(undefined);
          else if (Number.isFinite(n) && (!integer || (Number.isInteger(n) && n > 0))) onChange(n);
        }}
        className="h-[2.3em] font-mono"
      />
    </Setting>
  );
}

/** 展開一列時的設定：說明文字，以及這種欄位適用的驗證規則。 */
function FieldSettings({
  field,
  errors,
  onChange,
}: {
  field: FormField | TableColumn;
  errors: string[];
  onChange: (patch: Partial<FormField>) => void;
}) {
  const rules = (patch: Partial<FieldRules>) => onChange({ rules: { ...field.rules, ...patch } });
  const t = field.type;
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
        <div className="col-span-2">
          <Setting label="說明文字（選填，顯示在欄位下方）">
            <Input
              className="h-[2.3em]"
              value={field.help ?? ''}
              maxLength={200}
              onChange={(e) => onChange({ help: e.target.value || undefined })}
            />
          </Setting>
        </div>
        {(t === 'text' || t === 'textarea') && (
          <>
            <NumberSetting
              integer
              label="最少字數"
              value={field.rules.minLength}
              onChange={(v) => rules({ minLength: v })}
            />
            <NumberSetting
              integer
              label={`最多字數（上限 ${t === 'text' ? 200 : 5000}）`}
              value={field.rules.maxLength}
              onChange={(v) => rules({ maxLength: v })}
            />
          </>
        )}
        {t === 'text' && (
          <>
            <div className="col-span-2">
              <Setting label="格式（正規表示式，選填）">
                <Input
                  className="h-[2.3em] font-mono"
                  placeholder="例如 ^CC-\d{4}$"
                  spellCheck={false}
                  maxLength={100}
                  value={field.rules.pattern ?? ''}
                  onChange={(e) => rules({ pattern: e.target.value || undefined })}
                />
              </Setting>
            </div>
            {field.rules.pattern && (
              <div className="col-span-2">
                <Setting label="格式不符時的訊息">
                  <Input
                    className="h-[2.3em]"
                    placeholder="格式不正確"
                    maxLength={100}
                    value={field.rules.patternMessage ?? ''}
                    onChange={(e) => rules({ patternMessage: e.target.value || undefined })}
                  />
                </Setting>
              </div>
            )}
          </>
        )}
        {(t === 'number' || t === 'money') && (
          <>
            <NumberSetting
              label="最小值"
              value={field.rules.min}
              onChange={(v) => rules({ min: v })}
            />
            <NumberSetting
              label="最大值"
              value={field.rules.max}
              onChange={(v) => rules({ max: v })}
            />
          </>
        )}
        {t === 'date' && (
          // biome-ignore lint/a11y/noLabelWithoutControl: Switch 本身是 checkbox，label 直接包住它
          <label className="col-span-2 flex cursor-pointer items-center gap-2 self-end py-1">
            <Switch
              checked={!!field.rules.notPast}
              onChange={(e) => rules({ notPast: e.target.checked || undefined })}
            />
            不能早於今天
          </label>
        )}
        {(t === 'radio' || t === 'multiselect') && (
          <div className="col-span-2 row-span-2">
            <OptionsSetting
              options={field.options ?? []}
              onChange={(options) => onChange({ options })}
            />
          </div>
        )}
        {t === 'attachment' && (
          <>
            <div className="col-span-2">
              <AcceptSetting accept={field.rules.accept} onChange={(accept) => rules({ accept })} />
            </div>
            <NumberSetting
              label={`每個檔案的大小上限（MB，最多 ${ATTACHMENT_MAX_SIZE_MB}）`}
              value={field.rules.maxSizeMb}
              onChange={(v) => rules({ maxSizeMb: v })}
            />
            <NumberSetting
              integer
              label={`最多幾個檔案（最多 ${ATTACHMENT_MAX_FILES}）`}
              value={field.rules.maxFiles}
              onChange={(v) => rules({ maxFiles: v })}
            />
          </>
        )}
        {t === 'multiselect' && (
          <NumberSetting
            integer
            label="最多選幾項"
            value={field.rules.maxSelected}
            onChange={(v) => rules({ maxSelected: v })}
          />
        )}
        {t === 'person' && (
          <p className="col-span-2 self-end text-[0.85em] text-muted-foreground">
            填寫的人可以搜尋沒有停用的 Participant；存下的是 Participant ID，JSONata 以 ID 比對。
          </p>
        )}
        {t === 'table' && 'columns' in field && (
          <div className="col-span-2 lg:col-span-4">
            <ColumnsSetting
              columns={field.columns ?? []}
              onChange={(columns) => onChange({ columns })}
            />
          </div>
        )}
      </div>
      {errors.length > 0 && (
        <ul className="grid gap-1 text-[0.86em] text-destructive">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 允許的檔案類型：輸入「pdf, jpg」，離開時整理成 .pdf、.jpg；空白代表不限制。 */
function AcceptSetting({
  accept,
  onChange,
}: {
  accept: string[] | undefined;
  onChange: (accept: string[] | undefined) => void;
}) {
  const [text, setText] = useState((accept ?? []).join(', '));
  const apply = (value: string) => {
    const list = normalizeAccept(value);
    onChange(list.length ? list : undefined);
    return list;
  };
  return (
    <Setting label="允許的檔案類型（副檔名，逗號分隔；空白代表不限）">
      <Input
        className="h-[2.3em] font-mono"
        placeholder="例如 .pdf, .jpg, .png"
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          apply(e.target.value);
        }}
        onBlur={() => setText(apply(text).join(', '))}
      />
    </Setting>
  );
}

/**
 * 明細表的欄：每一欄和一般欄位一樣有名稱、代碼、類型、必填與規則（展開後設定）。
 * 代碼只需要在同一張明細表裡不重複；JSONata 以「明細表代碼.欄的代碼」讀取，例如 $sum(items.amount)。
 */
function ColumnsSetting({
  columns,
  onChange,
}: {
  columns: TableColumn[];
  onChange: (columns: TableColumn[]) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const patch = (id: string, p: Partial<TableColumn>) =>
    onChange(columns.map((c) => (c.id === id ? { ...c, ...p } : c)));
  return (
    <div className="grid gap-1.5">
      <span className="text-[0.85em] text-muted-foreground">
        明細表的欄位（每一行都要填這些欄）
      </span>
      <ul aria-label="明細表的欄位" className="grid overflow-hidden rounded-lg border bg-card">
        {columns.map((c, i) => (
          <li key={c.id} className="border-b last:border-0">
            <div className="grid grid-cols-[minmax(0,7em)_minmax(0,1.2fr)_minmax(0,1fr)_auto_auto_auto] items-center gap-2 px-2 py-1.5">
              <select
                aria-label={`第 ${i + 1} 欄的類型`}
                value={c.type}
                onChange={(e) => {
                  const type = e.target.value as TableColumn['type'];
                  const choice = type === 'radio' || type === 'multiselect';
                  patch(c.id, {
                    type,
                    rules: {},
                    options: choice ? (c.options?.length ? c.options : DEFAULT_OPTIONS) : undefined,
                  });
                }}
                className="h-8 min-w-0 rounded-md border border-input bg-card px-1.5 text-[0.9em]"
              >
                {TABLE_COLUMN_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FIELD_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <input
                value={c.label}
                maxLength={100}
                onChange={(e) => patch(c.id, { label: e.target.value })}
                aria-label={`第 ${i + 1} 欄的名稱`}
                aria-invalid={!c.label.trim() || undefined}
                className="h-8 min-w-0 rounded-md border border-input bg-card px-1.5 aria-invalid:border-destructive/60"
              />
              <input
                value={c.key}
                maxLength={50}
                onChange={(e) => patch(c.id, { key: e.target.value })}
                aria-label={`第 ${i + 1} 欄的代碼`}
                aria-invalid={
                  !FIELD_KEY_PATTERN.test(c.key) ||
                  columns.some((x) => x.id !== c.id && x.key === c.key) ||
                  undefined
                }
                spellCheck={false}
                className="h-8 min-w-0 rounded-md border border-input bg-card px-1.5 font-mono text-[0.88em] text-muted-foreground aria-invalid:border-destructive/60"
              />
              <label className="flex items-center gap-1 text-[0.85em]">
                <input
                  type="checkbox"
                  checked={c.required}
                  onChange={(e) => patch(c.id, { required: e.target.checked })}
                />
                必填
              </label>
              <button
                type="button"
                onClick={() => setOpen(open === c.id ? null : c.id)}
                aria-expanded={open === c.id}
                aria-label={`「${c.label}」的規則`}
                className="grid cursor-pointer place-items-center text-muted-foreground"
              >
                {open === c.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <button
                type="button"
                onClick={() => onChange(columns.filter((x) => x.id !== c.id))}
                aria-label={`刪除「${c.label}」欄`}
                className="grid cursor-pointer place-items-center text-muted-foreground hover:text-destructive"
              >
                <Trash2 size={14} />
              </button>
            </div>
            {open === c.id && (
              <div className="border-t border-dashed bg-muted/30 px-3 py-3">
                <FieldSettings
                  field={c}
                  errors={[]}
                  onChange={(p) => patch(c.id, p as Partial<TableColumn>)}
                />
              </div>
            )}
          </li>
        ))}
        {columns.length === 0 && (
          <li className="px-3 py-2 text-[0.9em] text-muted-foreground">還沒有欄位。</li>
        )}
      </ul>
      <div>
        <Button
          size="sm"
          variant="ghost"
          disabled={columns.length >= TABLE_MAX_COLUMNS}
          onClick={() => {
            const column = newColumn('text', columns);
            onChange([...columns, column]);
            setOpen(null);
          }}
        >
          <Plus size={14} aria-hidden /> 新增欄
        </Button>
      </div>
    </div>
  );
}

/** 一行一個選項；輸入時保留空行，離開時才整理。 */
function OptionsSetting({
  options,
  onChange,
}: {
  options: string[];
  onChange: (options: string[]) => void;
}) {
  const [text, setText] = useState(options.join('\n'));
  return (
    <Setting label="選項（一行一個）">
      <textarea
        rows={Math.max(3, options.length + 1)}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value.split('\n'));
        }}
        onBlur={() => {
          const tidy = text
            .split('\n')
            .map((o) => o.trim())
            .filter(Boolean);
          setText(tidy.join('\n'));
          onChange(tidy);
        }}
        className="w-full rounded-lg border border-input bg-card px-[0.8em] py-[0.4em] focus:border-ring focus:outline-none"
      />
    </Setting>
  );
}

type PreviewTab = 'fill' | 'readonly' | 'data' | 'rules';

/** 即時預覽：用和發起頁、API 相同的驗證試填；結果可以切到審批人看到的樣子與存下的資料。 */
function LivePreview({ form }: { form: FormSchema }) {
  const [tab, setTab] = useState<PreviewTab>('fill');
  const [tried, setTried] = useState<Record<string, unknown> | null>(null);
  // 欄位改了之後，重新驗證上次試送出的資料，看看 API 會不會接受。
  const result = tried ? validateFormData(form, tried, { today: todayIn() }) : null;
  const tabs: [PreviewTab, string][] = [
    ['fill', '填寫'],
    ['readonly', '審批人看到'],
    ['data', 'request_data'],
    ['rules', '驗證規則'],
  ];
  return (
    // 填寫時選到的人，切到「審批人看到」時顯示姓名。
    <PeopleNamesProvider>
      <section aria-label="即時預覽" className="flex min-h-0 flex-col bg-background">
        <div role="tablist" className="flex gap-0.5 border-b bg-card px-3 py-1.5 text-[0.88em]">
          <span className="mr-2 self-center text-muted-foreground">即時預覽</span>
          {tabs.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn(
                'cursor-pointer rounded-md px-2.5 py-1',
                tab === k ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <AttachmentTransportProvider value={previewTransport}>
            {tab === 'fill' && (
              <div className="rounded-xl border bg-card p-4">
                <FormRunner
                  key={JSON.stringify(form)}
                  form={form}
                  submitLabel="試送出"
                  onSubmit={({ data }) => {
                    setTried(data);
                    setTab('data');
                  }}
                  onInvalid={setTried}
                />
              </div>
            )}
            {tab === 'readonly' &&
              (tried && result?.success ? (
                <div className="rounded-xl border bg-card p-4">
                  <FormDataView form={form} data={result.data} />
                </div>
              ) : (
                <p className="text-muted-foreground">
                  在「填寫」試送出之後，這裡會顯示審批人看到的樣子。
                </p>
              ))}
            {tab === 'data' &&
              (result ? (
                <div className="grid gap-2">
                  <p className="text-[0.85em] text-muted-foreground">
                    {result.success
                      ? '通過驗證。這一步的資料會這樣存進 Postgres 的 request_data（不會進入 Temporal）：'
                      : 'API 會拒絕上次試送出的資料（422），各欄位的錯誤：'}
                  </p>
                  <pre className="overflow-auto rounded-lg border bg-card p-3 font-mono text-[0.82em]">
                    {JSON.stringify(result.success ? result.data : result.errors, null, 2)}
                  </pre>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  在「填寫」試送出之後，這裡會顯示存下的資料。
                </p>
              ))}
            {tab === 'rules' && (
              <div className="grid gap-2">
                <p className="text-[0.85em] text-muted-foreground">
                  由這份 Form 產生的驗證；發起頁、填表頁與 API 都用同一份。
                </p>
                <table className="w-full overflow-hidden rounded-lg border bg-card text-[0.9em]">
                  <tbody>
                    {form.fields.flatMap((f) =>
                      [
                        { id: f.id, key: f.key, field: f as FormField | TableColumn },
                        // 明細表每一行的欄，代碼寫成 JSONata 讀取的路徑。
                        ...(f.columns ?? []).map((c) => ({
                          id: c.id,
                          key: `${f.key}[].${c.key}`,
                          field: c as FormField | TableColumn,
                        })),
                      ].map(({ id, key, field: x }) => (
                        <tr key={id} className="border-b last:border-0">
                          <td className="px-3 py-1.5 font-mono text-[0.9em]">{key}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {[
                              FIELD_TYPE_LABELS[x.type],
                              x.required
                                ? x.type === 'checkbox'
                                  ? '必須勾選'
                                  : x.type === 'table'
                                    ? '至少一行'
                                    : '必填'
                                : '選填',
                              ...describeRules(x),
                            ].join(' · ')}
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </AttachmentTransportProvider>
        </div>
      </section>
    </PeopleNamesProvider>
  );
}
