import '@xyflow/react/dist/style.css';
import type { MeResponse, Process, ProcessSummary, ProcessVersion } from '@river/contracts';
import {
  type Assignee,
  type DslError,
  formIdOf,
  NODE_TYPE_LABELS,
  type NodeSettings,
  type NodeType,
  type ProcessDsl,
} from '@river/dsl';
import type { FormSchema } from '@river/forms';
import { useQuery } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { Background, Controls, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import {
  CircleAlert,
  CircleCheck,
  FileText,
  Lock,
  Plus,
  Save,
  Search,
  Send,
  Trash2,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import { type DragEvent, type FormEvent, useMemo, useRef, useState } from 'react';
import { Avatar, PersonPicker } from '@/components/people';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { directoryQueryOptions, roleDirectoryQueryOptions } from '@/lib/org';
import {
  processesQueryOptions,
  processQueryOptions,
  publishRejection,
  useCreateProcess,
  useDiscardDraft,
  usePublishProcess,
  useRenameProcess,
  useSaveDraft,
} from '@/lib/processes';
import { cn } from '@/lib/utils';
import { FormSheet, type FormSlot, newForm } from './form-designer';
import {
  CanvasFormsContext,
  NODE_HEIGHT,
  NODE_ICONS,
  NODE_WIDTH,
  nodeTypes,
  type RFNode,
  sameDsl,
  useProcessCanvas,
} from './process-canvas';

type ProcessStatus = 'unpublished' | 'published' | 'published-with-draft';

function statusOf(p: ProcessSummary): ProcessStatus {
  if (p.currentVersion === null) return 'unpublished';
  return p.draftSavedAt ? 'published-with-draft' : 'published';
}

const STATUS = {
  unpublished: { text: '尚未發佈', dot: 'bg-status-closed' },
  published: { text: '已發佈', dot: 'bg-status-approved' },
  'published-with-draft': { text: '有未發佈的草稿', dot: 'bg-status-returned' },
} as const;

const dateTime = new Intl.DateTimeFormat('zh-TW', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const formatTime = (iso: string) => dateTime.format(new Date(iso));

/** 流程設計頁：左欄 Process 清單；右欄畫布、屬性面板與問題面板（A「IDE」）。 */
export function ProcessesPage({
  me,
  selected,
  onSelect,
}: {
  me: MeResponse;
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const processes = useQuery(processesQueryOptions);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const list = (processes.data ?? []).filter((p) =>
    p.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <>
      <section className="flex min-h-0 flex-col border-border bg-card md:border-r">
        <div className="flex items-center justify-between gap-2 p-3">
          <h1 className="font-semibold text-[1.15em]">流程設計</h1>
          <Button size="sm" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
            <Plus size={14} aria-hidden /> 新增 Process
          </Button>
        </div>
        {adding && (
          <NewProcessForm
            onCreated={(process) => {
              setAdding(false);
              onSelect(process.id);
            }}
          />
        )}
        <div className="relative mx-3 mb-2">
          <Search
            size={15}
            aria-hidden
            className="-translate-y-1/2 absolute top-1/2 left-[0.7em] text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="搜尋 Process"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋 Process"
            className="h-[2.3em] border-transparent bg-muted pl-[2.2em]"
          />
        </div>
        <ul className="flex-1 overflow-auto border-t">
          {processes.isPending && <li className="px-3 py-2.5 text-muted-foreground">載入中…</li>}
          {processes.data?.length === 0 && (
            <li className="px-3 py-2.5 text-muted-foreground">還沒有 Process。</li>
          )}
          {list.map((p) => {
            const status = STATUS[statusOf(p)];
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  aria-current={selected === p.id || undefined}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2.5 border-b px-3 py-2.5 text-left hover:bg-muted/60',
                    selected === p.id && 'bg-accent hover:bg-accent',
                  )}
                >
                  <span className="grid size-8 place-items-center rounded-md bg-muted text-muted-foreground">
                    <Workflow size={16} aria-hidden />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="flex items-center gap-1.5 text-[0.82em] text-muted-foreground">
                      <span className={cn('size-[7px] rounded-full', status.dot)} />
                      {status.text}
                      {p.draftSavedAt && ` · 草稿 ${formatTime(p.draftSavedAt)}`}
                    </span>
                  </span>
                  {p.currentVersion !== null && (
                    <span className="rounded-md bg-muted px-1.5 font-mono text-[0.8em] text-muted-foreground">
                      v{p.currentVersion}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex min-h-[70vh] min-w-0 flex-col md:min-h-0">
        {selected ? (
          <ProcessEditorLoader key={selected} id={selected} me={me} />
        ) : (
          <div className="grid min-h-[50vh] place-items-center content-center gap-2.5 px-4 py-16 text-center">
            <div className="grid size-14 place-items-center rounded-[calc(var(--radius)+6px)] bg-muted text-muted-foreground">
              <Workflow size={26} aria-hidden />
            </div>
            <h2 className="font-semibold text-[1.3em]">選擇一個 Process</h2>
            <p className="max-w-[36em] text-muted-foreground">
              在畫布上拖拉節點、連線，設定審批人與填表人，設計開始表單與填表用的
              Form；通過檢查後就可以發佈成新的 Process Version。
            </p>
          </div>
        )}
      </section>
    </>
  );
}

function NewProcessForm({ onCreated }: { onCreated: (process: Process) => void }) {
  const [name, setName] = useState('');
  const create = useCreateProcess();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(name.trim(), {
      onSuccess: (process) => {
        toast(`已建立「${process.name}」的草稿`);
        onCreated(process);
      },
    });
  }

  return (
    <form onSubmit={submit} className="mx-3 mb-3 grid gap-2 rounded-lg border bg-muted/40 p-2.5">
      <Input
        autoFocus
        aria-label="Process 名稱"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Process 名稱，例如「出差申請」"
      />
      <p className="text-[0.85em] text-muted-foreground">
        會建立一份只有「開始」和「結束」的草稿。
      </p>
      {create.error && <p className="text-[0.85em] text-destructive">{create.error.message}</p>}
      <Button size="sm" type="submit" disabled={create.isPending} className="justify-self-end">
        建立草稿
      </Button>
    </form>
  );
}

function ProcessEditorLoader({ id, me }: { id: string; me: MeResponse }) {
  const process = useQuery(processQueryOptions(id));
  if (process.isPending) return <p className="p-4 text-muted-foreground">載入中…</p>;
  if (process.isError) return <p className="p-4 text-destructive">{process.error.message}</p>;
  return (
    <ReactFlowProvider>
      <ProcessEditor process={process.data} me={me} />
    </ReactFlowProvider>
  );
}

/** 草稿；沒有草稿時從目前版本開始編輯。 */
function workingDsl(process: Process): ProcessDsl {
  const current = process.versions.at(-1);
  return process.draft?.dsl ?? current?.dsl ?? { nodes: [], edges: [], forms: [] };
}

function ProcessEditor({ process, me }: { process: Process; me: MeResponse }) {
  const [tab, setTab] = useState<'draft' | number>('draft');
  /** 草稿分頁裡正在看的是流程畫布（null）還是某一份 Form。 */
  const [formTab, setFormTab] = useState<string | null>(null);
  const base = useMemo(() => workingDsl(process), [process]);
  const canvas = useProcessCanvas(base);
  const dirty = !sameDsl(canvas.dsl, base);
  const [problemsOpen, setProblemsOpen] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const rf = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const save = useSaveDraft();
  const discard = useDiscardDraft();
  const canPublish = me.permissions.includes('process.publish');
  const current = process.versions.at(-1);
  const viewing =
    typeof tab === 'number' ? process.versions.find((v) => v.version === tab) : undefined;
  const hasDraft = !!process.draft || dirty;

  useBlocker({
    shouldBlockFn: () => dirty && !window.confirm('草稿有未儲存的變更，確定要離開嗎？'),
    enableBeforeUnload: () => dirty,
  });

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/river-node') as NodeType;
    if (!(type in NODE_TYPE_LABELS)) return;
    canvas.addNode(type, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  }

  function addAtCenter(type: NodeType) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const center = rf.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    canvas.addNode(type, { x: center.x - NODE_WIDTH / 2, y: center.y - NODE_HEIGHT / 2 });
  }

  function focus(error: DslError) {
    if (error.formId) {
      setFormTab(error.formId);
      return;
    }
    setFormTab(null);
    const node = canvas.nodes.find((n) => n.id === error.nodeId);
    if (!node) return;
    canvas.select(node.id);
    void rf.setCenter(node.position.x + NODE_WIDTH / 2, node.position.y + NODE_HEIGHT / 2, {
      zoom: 1.1,
      duration: 300,
    });
  }

  function saveDraft() {
    save.mutate(
      { id: process.id, dsl: canvas.dsl },
      {
        onSuccess: () => toast('草稿已儲存'),
        onError: (error) => toast(error.message, 'error'),
      },
    );
  }

  function discardDraft() {
    if (!current) return;
    if (!window.confirm(`捨棄草稿後會回到 v${current.version}，草稿的改動都會消失。確定嗎？`))
      return;
    discard.mutate(process.id, {
      onSuccess: () => {
        canvas.reset(current.dsl);
        toast(`已捨棄草稿，回到 v${current.version}`);
      },
      onError: (error) => toast(error.message, 'error'),
    });
  }

  const publishBlockedReason = !canPublish
    ? '需要 process.publish Permission 才能發佈'
    : canvas.errors.length > 0
      ? '先修正所有問題才能發佈'
      : !hasDraft
        ? '目前版本之後沒有改動'
        : undefined;

  const openForm = canvas.forms.find((f) => f.id === formTab);
  const slots: FormSlot[] = canvas.nodes.flatMap((n) => {
    const node = n.data.node;
    return node.type === 'start' || node.type === 'form'
      ? [{ id: n.id, type: node.type, name: node.name, formId: formIdOf(node) }]
      : [];
  });

  function addForm() {
    const form = newForm(canvas.forms);
    canvas.setForms([...canvas.forms, form]);
    setFormTab(form.id);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b bg-card px-4 py-2.5">
        <ProcessName process={process} />
        <nav
          aria-label="版本"
          className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5 text-[0.9em]"
        >
          <TabButton active={tab === 'draft'} onClick={() => setTab('draft')}>
            草稿{!hasDraft && current ? `（同 v${current.version}）` : ''}
          </TabButton>
          {[...process.versions].reverse().map((v) => (
            <TabButton key={v.version} active={tab === v.version} onClick={() => setTab(v.version)}>
              <Lock size={11} aria-hidden />
              <span className="font-mono">v{v.version}</span>
              {v.version === current?.version && (
                <span className="text-[0.8em] text-status-approved">目前</span>
              )}
            </TabButton>
          ))}
        </nav>
        <div className="flex-1" />
        {tab === 'draft' && (
          <>
            <span className="text-[0.85em] text-muted-foreground">
              {dirty
                ? '有未儲存的變更'
                : process.draft
                  ? `已儲存 · ${process.draft.savedBy.name} · ${formatTime(process.draft.savedAt)}`
                  : ''}
            </span>
            {process.draft && current && (
              <Button size="sm" variant="ghost" disabled={discard.isPending} onClick={discardDraft}>
                捨棄草稿
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={!dirty || save.isPending}
              onClick={saveDraft}
            >
              <Save size={14} aria-hidden /> 儲存草稿
            </Button>
            <Button
              size="sm"
              disabled={!!publishBlockedReason}
              title={publishBlockedReason}
              onClick={() => setPublishing(true)}
            >
              <Send size={14} aria-hidden /> 發佈
              {canvas.errors.length > 0 && (
                <span className="rounded bg-white/25 px-1 font-mono text-[0.85em]">
                  {canvas.errors.length}
                </span>
              )}
            </Button>
          </>
        )}
      </header>

      {!viewing && (
        <nav
          aria-label="流程與 Form"
          className="flex items-end gap-1 overflow-x-auto border-b bg-muted/40 px-3 pt-1.5"
        >
          <DocTab active={!openForm} onClick={() => setFormTab(null)}>
            流程
          </DocTab>
          {canvas.forms.map((f) => (
            <DocTab
              key={f.id}
              active={openForm?.id === f.id}
              error={canvas.errors.some((e) => e.formId === f.id)}
              onClick={() => setFormTab(f.id)}
            >
              <FileText size={13} aria-hidden className="text-muted-foreground" />
              {f.name || '（未命名）'}
            </DocTab>
          ))}
          <button
            type="button"
            aria-label="新增 Form"
            title="新增 Form"
            onClick={addForm}
            className="mb-1 grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <Plus size={15} />
          </button>
        </nav>
      )}

      {viewing ? (
        <VersionView key={viewing.version} version={viewing} />
      ) : openForm ? (
        <>
          <FormSheet
            key={openForm.id}
            form={openForm}
            forms={canvas.forms}
            slots={slots}
            errors={canvas.errors.filter((e) => e.formId === openForm.id)}
            onChange={(next) =>
              canvas.setForms(canvas.forms.map((f) => (f.id === next.id ? next : f)))
            }
            onAssign={(nodeId, formId) => canvas.updateNode(nodeId, { formId })}
            onDelete={() => {
              canvas.setForms(canvas.forms.filter((f) => f.id !== openForm.id));
              for (const slot of slots)
                if (slot.formId === openForm.id) canvas.updateNode(slot.id, { formId: null });
              setFormTab(null);
            }}
          />
          <Problems
            errors={canvas.errors}
            open={problemsOpen}
            onToggle={() => setProblemsOpen((v) => !v)}
            onPick={focus}
          />
        </>
      ) : (
        <CanvasFormsContext.Provider value={canvas.forms}>
          <div ref={canvasRef} className="relative min-h-0 flex-1">
            <ReactFlow
              nodes={canvas.nodes}
              edges={canvas.edges}
              nodeTypes={nodeTypes}
              onNodesChange={canvas.onNodesChange}
              onEdgesChange={canvas.onEdgesChange}
              onConnect={canvas.onConnect}
              onDrop={onDrop}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              fitView
              fitViewOptions={{ maxZoom: 1.1 }}
              deleteKeyCode={['Backspace', 'Delete']}
              defaultEdgeOptions={{ style: { strokeWidth: 1.5 } }}
            >
              <Background gap={16} />
              <Controls position="bottom-left" showInteractive={false} />
            </ReactFlow>
            <Palette onAdd={addAtCenter} />
            {canvas.selected && (
              <Inspector
                key={canvas.selected.id}
                node={canvas.selected}
                forms={canvas.forms}
                onChange={(patch) =>
                  canvas.selected && canvas.updateNode(canvas.selected.id, patch)
                }
                onOpenForm={setFormTab}
                onNewForm={() => {
                  const form = newForm(canvas.forms);
                  canvas.setForms([...canvas.forms, form]);
                  if (canvas.selected) canvas.updateNode(canvas.selected.id, { formId: form.id });
                  setFormTab(form.id);
                }}
                onRemove={() => canvas.selected && canvas.removeNode(canvas.selected.id)}
                onClose={() => canvas.select(null)}
              />
            )}
          </div>
          <Problems
            errors={canvas.errors}
            open={problemsOpen}
            onToggle={() => setProblemsOpen((v) => !v)}
            onPick={focus}
          />
        </CanvasFormsContext.Provider>
      )}

      {publishing && (
        <PublishDialog
          process={process}
          dsl={canvas.dsl}
          dirty={dirty}
          onClose={() => setPublishing(false)}
          onPublished={() => setTab('draft')}
        />
      )}
    </div>
  );
}

function DocTab({
  active,
  error,
  onClick,
  children,
}: {
  active: boolean;
  error?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active || undefined}
      className={cn(
        '-mb-px flex shrink-0 cursor-pointer items-center gap-1.5 rounded-t-lg border border-transparent px-3 py-1.5 text-[0.92em]',
        active
          ? 'border-border border-b-card bg-card font-medium'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
      {error && (
        <>
          <span aria-hidden className="size-1.5 rounded-full bg-destructive" />
          <span className="sr-only">（有問題）</span>
        </>
      )}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1',
        active ? 'bg-card shadow-sm' : 'text-muted-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** 名稱可以直接改；按 Enter 或離開輸入框時儲存，失敗時還原。 */
function ProcessName({ process }: { process: Process }) {
  const [name, setName] = useState(process.name);
  const rename = useRenameProcess();

  function commit() {
    const next = name.trim();
    if (!next || next === process.name) {
      setName(process.name);
      return;
    }
    rename.mutate(
      { id: process.id, name: next },
      {
        onError: (error) => {
          setName(process.name);
          toast(error.message, 'error');
        },
      },
    );
  }

  return (
    <input
      aria-label="Process 名稱"
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setName(process.name);
      }}
      className="w-44 rounded-md bg-transparent px-1 font-semibold text-[1.15em] hover:bg-muted focus:bg-muted focus:outline-none"
    />
  );
}

const PALETTE: { type: NodeType; hint: string }[] = [
  { type: 'start', hint: '流程從這裡開始，可以指定開始表單' },
  { type: 'form', hint: '指派一位 Participant 填一份 Form' },
  { type: 'approval', hint: '指派一位 Participant 審批' },
  { type: 'end', hint: '流程結束' },
];

/** 拖到畫布上指定位置，或點一下放在畫面中央。 */
function Palette({ onAdd }: { onAdd: (type: NodeType) => void }) {
  return (
    <div className="absolute top-3 left-3 z-10 grid w-44 gap-1 rounded-lg border bg-card p-1.5 shadow-sm">
      <p className="px-1.5 pt-0.5 pb-1 text-[0.8em] text-muted-foreground">拖到畫布上或點一下</p>
      {PALETTE.map((item) => {
        const Icon = NODE_ICONS[item.type];
        return (
          <button
            type="button"
            key={item.type}
            draggable
            onClick={() => onAdd(item.type)}
            onDragStart={(e) => {
              e.dataTransfer.setData('application/river-node', item.type);
              e.dataTransfer.effectAllowed = 'move';
            }}
            title={item.hint}
            className="flex cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
          >
            <Icon size={15} className="text-muted-foreground" aria-hidden />
            {NODE_TYPE_LABELS[item.type]}
          </button>
        );
      })}
    </div>
  );
}

function Inspector({
  node,
  forms,
  onChange,
  onRemove,
  onClose,
  onOpenForm,
  onNewForm,
}: {
  node: RFNode;
  forms: FormSchema[];
  onChange: (patch: Partial<NodeSettings>) => void;
  onRemove: () => void;
  onClose: () => void;
  onOpenForm: (formId: string) => void;
  onNewForm: () => void;
}) {
  const settings = node.data.node;
  return (
    <aside
      aria-label="節點設定"
      className="absolute top-3 right-3 bottom-3 z-10 flex w-72 flex-col gap-3 overflow-auto rounded-lg border bg-card p-3 shadow-md"
    >
      <div className="flex items-center justify-between">
        <span className="text-[0.85em] text-muted-foreground">
          {NODE_TYPE_LABELS[settings.type]}節點
        </span>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="關閉">
          <X size={15} />
        </Button>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="node-name" className="font-normal text-[0.85em] text-muted-foreground">
          名稱
        </Label>
        <Input
          id="node-name"
          value={settings.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>
      {(settings.type === 'approval' || settings.type === 'form') && (
        <AssigneeField
          key={node.id}
          label={settings.type === 'form' ? '填表人' : '審批人'}
          assignee={settings.assignee}
          onChange={(assignee) => onChange({ assignee })}
        />
      )}
      {(settings.type === 'start' || settings.type === 'form') && (
        <div className="grid gap-1.5">
          <Label htmlFor="node-form" className="font-normal text-[0.85em] text-muted-foreground">
            {settings.type === 'start' ? '開始表單' : '要填的 Form'}
          </Label>
          <select
            id="node-form"
            value={settings.formId ?? ''}
            aria-invalid={(settings.type === 'form' && !settings.formId) || undefined}
            onChange={(e) => onChange({ formId: e.target.value || null })}
            className="h-[2.5em] w-full rounded-lg border border-input bg-card px-2 aria-invalid:border-destructive"
          >
            <option value="">
              {settings.type === 'start' ? '不需要表單（只填標題）' : '選擇 Form…'}
            </option>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name || '（未命名）'}（{f.fields.length} 個欄位）
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-x-3 text-[0.88em]">
            {settings.formId && forms.some((f) => f.id === settings.formId) && (
              <button
                type="button"
                className="cursor-pointer text-primary hover:underline"
                onClick={() => settings.formId && onOpenForm(settings.formId)}
              >
                打開這份 Form 的分頁 →
              </button>
            )}
            <button
              type="button"
              className="cursor-pointer text-primary hover:underline"
              onClick={onNewForm}
            >
              ＋ 建立新 Form
            </button>
          </div>
        </div>
      )}
      {node.data.errors.length > 0 && (
        <ul className="grid gap-1.5">
          {node.data.errors.map((e, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: 同一個節點可能有多筆完全相同的錯誤
              key={`${e.code}-${i}`}
              className="flex gap-1.5 rounded-md bg-destructive/8 p-2 text-[0.88em] text-destructive"
            >
              <CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
              {e.message}
            </li>
          ))}
        </ul>
      )}
      <div className="flex-1" />
      <Button
        size="sm"
        variant="ghost"
        className="justify-self-start text-destructive"
        onClick={onRemove}
      >
        <Trash2 size={14} aria-hidden /> 刪除節點
      </Button>
    </aside>
  );
}

const ASSIGNEE_MODES = [
  { key: 'participant', label: '特定人員' },
  { key: 'role', label: 'Role' },
  { key: 'manager', label: 'Manager' },
] as const;

/**
 * 指派對象：特定 Participant、一個 Role（任一成員都可以直接處理，最先送出的生效），
 * 或發起人的 Manager（必須另外設定 Fallback Role）。
 */
function AssigneeField({
  label,
  assignee,
  onChange,
}: {
  label: string;
  assignee: Assignee | null;
  onChange: (assignee: Assignee | null) => void;
}) {
  // 還沒選好對象時也要記得正在選哪一種。
  const [mode, setMode] = useState<Assignee['type']>(assignee?.type ?? 'participant');
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.85em] text-muted-foreground">{label}</span>
        <div
          role="group"
          aria-label={`${label}的指派方式`}
          className="inline-flex rounded-md bg-muted p-0.5 text-[0.8em]"
        >
          {ASSIGNEE_MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={mode === m.key}
              onClick={() => {
                if (m.key === mode) return;
                setMode(m.key);
                // 選 Manager 本身就是完整的指派方式，只差 Fallback Role（由檢查器提醒）。
                onChange(m.key === 'manager' ? { type: 'manager', fallbackRoleId: null } : null);
              }}
              className={cn(
                'cursor-pointer rounded px-2 py-0.5 text-muted-foreground',
                mode === m.key && 'bg-card text-foreground shadow-sm',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {mode === 'participant' && (
        <ParticipantAssignee
          participantId={assignee?.type === 'participant' ? assignee.participantId : null}
          onChange={(participantId) =>
            onChange(participantId ? { type: 'participant', participantId } : null)
          }
        />
      )}
      {mode === 'role' && (
        <RoleAssignee
          roleId={assignee?.type === 'role' ? assignee.roleId : null}
          onChange={(roleId) => onChange(roleId ? { type: 'role', roleId } : null)}
        />
      )}
      {mode === 'manager' && (
        <>
          <p className="text-[0.85em]">
            Task 指派給發起人的 Manager。發起人沒有 Manager，或 Manager 已停用時，改派給 Fallback
            Role。
          </p>
          <RoleAssignee
            label="Fallback Role"
            placeholder="選擇 Fallback Role…"
            hint="發起人沒有有效的 Manager 時，由這個 Role 的任一成員處理。"
            roleId={assignee?.type === 'manager' ? assignee.fallbackRoleId : null}
            onChange={(fallbackRoleId) => onChange({ type: 'manager', fallbackRoleId })}
          />
        </>
      )}
    </div>
  );
}

function RoleAssignee({
  roleId,
  onChange,
  label = 'Role',
  placeholder = '選擇 Role…',
  hint = 'Role 的每位成員都會看到這個 Task，不需要認領；最先送出的決定生效。',
}: {
  roleId: string | null;
  onChange: (roleId: string | null) => void;
  label?: string;
  placeholder?: string;
  hint?: string;
}) {
  const roles = useQuery(roleDirectoryQueryOptions);
  const role = roles.data?.find((r) => r.id === roleId);
  return (
    <>
      <div className="relative">
        <Users
          size={14}
          aria-hidden
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 text-muted-foreground"
        />
        <select
          aria-label={label}
          value={roleId ?? ''}
          disabled={roles.isPending}
          aria-invalid={!roleId || undefined}
          onChange={(e) => onChange(e.target.value || null)}
          className="h-[2.5em] w-full rounded-lg border border-input bg-card pr-2 pl-7 aria-invalid:border-destructive"
        >
          <option value="">{placeholder}</option>
          {roles.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}（{r.memberCount} 人）
            </option>
          ))}
        </select>
      </div>
      <p className="text-[0.8em] text-muted-foreground">
        {role && role.memberCount === 0 ? '這個 Role 目前沒有成員，Task 會沒有人可以處理。' : hint}
      </p>
      {roles.isError && <p className="text-[0.85em] text-destructive">{roles.error.message}</p>}
    </>
  );
}

function ParticipantAssignee({
  participantId,
  onChange,
}: {
  participantId: string | null;
  onChange: (participantId: string | null) => void;
}) {
  const people = useQuery(directoryQueryOptions);
  const person = people.data?.find((p) => p.id === participantId);
  return (
    <>
      {participantId ? (
        <div className="flex items-center gap-2 rounded-lg border px-2 py-1.5">
          {person && <Avatar id={person.id} name={person.name} size={24} />}
          <span className="grid min-w-0 flex-1">
            <span className="truncate">{person?.name ?? '…'}</span>
            <span className="truncate text-[0.8em] text-muted-foreground">
              {person?.status === 'deactivated' ? '已停用，請更換' : person?.email}
            </span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            更換
          </Button>
        </div>
      ) : (
        <PersonPicker
          people={people.data ?? []}
          disabled={people.isPending}
          onPick={(p) => onChange(p.id)}
        />
      )}
      {people.isError && <p className="text-[0.85em] text-destructive">{people.error.message}</p>}
    </>
  );
}

function Problems({
  errors,
  open,
  onToggle,
  onPick,
}: {
  errors: DslError[];
  open: boolean;
  onToggle: () => void;
  onPick: (e: DslError) => void;
}) {
  return (
    <div className="border-t bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-1.5 text-[0.88em]"
      >
        {errors.length === 0 ? (
          <CircleCheck size={14} className="text-status-approved" aria-hidden />
        ) : (
          <CircleAlert size={14} className="text-destructive" aria-hidden />
        )}
        <span className="font-medium">問題</span>
        <span className="text-muted-foreground">
          {errors.length === 0 ? '沒有問題，可以發佈' : `${errors.length} 個`}
        </span>
        <span className="flex-1" />
        <span className="text-muted-foreground">{open ? '收合' : '展開'}</span>
      </button>
      {open && errors.length > 0 && <ErrorList errors={errors} onPick={onPick} />}
    </div>
  );
}

function ErrorList({ errors, onPick }: { errors: DslError[]; onPick?: (e: DslError) => void }) {
  return (
    <ul className="max-h-36 overflow-auto border-t font-mono text-[0.85em]">
      {errors.map((e, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 同一個節點可能有多筆完全相同的錯誤（例如兩條懸空的邊）
        <li key={`${e.code}-${e.nodeId}-${i}`}>
          <button
            type="button"
            disabled={!onPick || !(e.nodeId || e.formId)}
            onClick={() => onPick?.(e)}
            className="flex w-full items-center gap-3 px-4 py-1 text-left enabled:cursor-pointer enabled:hover:bg-muted"
          >
            <span className="w-44 shrink-0 text-destructive">{e.code}</span>
            <span className="w-28 shrink-0 truncate text-muted-foreground">
              {e.nodeId ?? e.formId ?? '—'}
            </span>
            <span className="font-sans">{e.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function VersionView({ version }: { version: ProcessVersion }) {
  const { nodes, edges } = useProcessCanvas(version.dsl);
  return (
    <CanvasFormsContext.Provider value={version.dsl.forms}>
      <div className="relative min-h-0 flex-1">
        <div className="-translate-x-1/2 absolute top-3 left-1/2 z-10 flex max-w-[90%] items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-[0.88em] shadow-sm">
          <Lock size={13} className="shrink-0" aria-hidden />
          <span className="truncate">
            Process Version {version.version} 不可修改 · {version.publishedBy.name} 發佈於{' '}
            {formatTime(version.publishedAt)}
            {version.note && <span className="text-muted-foreground"> · {version.note}</span>}
          </span>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ maxZoom: 1.1 }}
        >
          <Background gap={16} />
        </ReactFlow>
      </div>
    </CanvasFormsContext.Provider>
  );
}

function summary(dsl: ProcessDsl): string {
  const approvals = dsl.nodes.filter((n) => n.type === 'approval').length;
  const forms = dsl.nodes.filter((n) => n.type === 'form').length;
  return `${dsl.nodes.length} 個節點、${approvals} 個審批、${forms} 個填表、${dsl.edges.length} 條連線、${dsl.forms.length} 份 Form`;
}

/** 有未儲存的變更時先儲存草稿，再發佈已儲存的草稿；API 拒絕時在對話框內列出錯誤。 */
function PublishDialog({
  process,
  dsl,
  dirty,
  onClose,
  onPublished,
}: {
  process: Process;
  dsl: ProcessDsl;
  dirty: boolean;
  onClose: () => void;
  onPublished: () => void;
}) {
  const [note, setNote] = useState('');
  const save = useSaveDraft();
  const publish = usePublishProcess();
  const current = process.versions.at(-1);
  const nextVersion = (current?.version ?? 0) + 1;
  const busy = save.isPending || publish.isPending;
  const rejection = publishRejection(publish.error);
  const error = save.error ?? (rejection ? null : publish.error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (dirty) await save.mutateAsync({ id: process.id, dsl });
    await publish.mutateAsync({ id: process.id, note: note.trim() });
    onPublished();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <div
        role="dialog"
        aria-modal
        aria-labelledby="publish-title"
        className="grid w-full max-w-md gap-4 rounded-xl border bg-card p-5 shadow-xl"
      >
        {publish.data ? (
          <>
            <h2 id="publish-title" className="flex items-center gap-2 font-semibold text-[1.1em]">
              <CircleCheck className="text-status-approved" aria-hidden /> 已發佈 v
              {publish.data.version}
            </h2>
            <p className="text-muted-foreground">
              「{process.name}」的目前版本是 v{publish.data.version}。之後發起的 Request
              會使用這個版本；進行中的 Request 繼續使用原本的版本。
            </p>
            <Button className="justify-self-end" onClick={onClose}>
              完成
            </Button>
          </>
        ) : (
          <form onSubmit={(e) => void submit(e).catch(() => {})} className="grid gap-4">
            <h2 id="publish-title" className="font-semibold text-[1.1em]">
              發佈「{process.name}」為 v{nextVersion}
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.92em]">
              <dt className="text-muted-foreground">目前版本</dt>
              <dd>{current ? `v${current.version}（${summary(current.dsl)}）` : '尚未發佈'}</dd>
              <dt className="text-muted-foreground">這次發佈</dt>
              <dd>
                {summary(dsl)}
                {dirty && <span className="text-muted-foreground">（會先儲存草稿）</span>}
              </dd>
              <dt className="text-muted-foreground">檢查</dt>
              <dd className="flex items-center gap-1 text-status-approved">
                <CircleCheck size={14} aria-hidden /> 全部通過
              </dd>
            </dl>
            <div className="grid gap-1">
              <Label
                htmlFor="version-note"
                className="font-normal text-[0.85em] text-muted-foreground"
              >
                版本說明（選填）
              </Label>
              <Input
                id="version-note"
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例如：加上人資確認"
              />
            </div>
            <p className="flex gap-1.5 rounded-md bg-muted p-2 text-[0.85em] text-muted-foreground">
              <Lock size={14} className="mt-0.5 shrink-0" aria-hidden />
              發佈後 v{nextVersion} 不能再修改；要改動請編輯草稿後再發佈新版本。
            </p>
            {rejection && (
              <div className="grid gap-1.5 overflow-hidden rounded-md border border-destructive/40">
                <p className="px-3 pt-2 text-[0.88em] text-destructive">{rejection.message}</p>
                <ErrorList errors={rejection.errors} />
              </div>
            )}
            {error && <p className="text-[0.88em] text-destructive">{error.message}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                取消
              </Button>
              <Button type="submit" disabled={busy}>
                <Send size={14} aria-hidden /> 發佈 v{nextVersion}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
