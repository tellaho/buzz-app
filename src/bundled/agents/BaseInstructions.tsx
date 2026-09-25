import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  AgentInstructions,
  InstructionCategory,
  SavedInstructions,
  SavedModule,
} from "../../features/agent-instructions/service";
import {
  INSTRUCTION_TONES,
  validInstructionBody,
} from "../../features/agent-instructions/service";
import type {
  AgentControl,
  AgentControlState,
} from "../../features/agents/control";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "../../shared/design-system/icons";
import { AlertDialog } from "../../shared/design-system/ui/AlertDialog";
import { Button } from "../../shared/design-system/ui/Button";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { Input } from "../../shared/design-system/ui/Input";
import {
  MenuIcon,
  MenuItem,
  MenuPopup,
  MenuRoot,
  MenuTrigger,
} from "../../shared/design-system/ui/Menu";
import {
  PopoverDescription,
  PopoverPopup,
  PopoverRoot,
  PopoverTitle,
  PopoverTrigger,
} from "../../shared/design-system/ui/Popover";
import { Textarea } from "../../shared/design-system/ui/Textarea";
import { Tabs } from "../../shared/design-system/ui/Tabs";
import { Panel } from "../../shared/design-system/ui/Panel";
import { PanelHeader } from "../../shared/design-system/ui/PanelHeader";
import { PanelFrame } from "../../features/panels/PanelFrame";
import {
  availableInstructionModules,
  DEFAULT_INSTRUCTIONS_PLUGIN,
  editableInstructionModule,
  estimateInstructionTokens,
  instructionBoardColumns,
  instructionCategory,
  instructionCategorySummaries,
  instructionEditorText,
  instructionDraft,
  instructionDraftChanged,
  instructionModuleState,
  instructionPercentage,
  instructionPrompt,
  instructionTileSpan,
  LOCAL_INSTRUCTIONS_PLUGIN,
  LOCAL_INSTRUCTIONS_REVISION,
  normalizedModules,
  nextInstructionTone,
  preparedInstructionDraft,
  sourceModule,
  type InstructionModuleState,
  type MutableInstructionDraft,
} from "./base-instruction-draft";

type Editor = {
  location: "active" | "available" | "new";
  module: SavedModule;
  title: string;
  text: string;
  editing: boolean;
  trigger: HTMLElement | null;
  returnFocus: string | undefined;
};
type Drag = {
  key: string;
  pointerId: number;
  startX: number;
  startY: number;
  started: boolean;
  targets: {
    key: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
  }[];
};
type DragOffset = { key: string; x: number; y: number };
type DropTarget = { index: number; category?: string };
type BoardStyle = CSSProperties & {
  "--base-prompt-board-columns": number;
  "--base-prompt-board-cell": string;
};
/** Global profile editor. Drafts remain local until one CAS-pinned adoption. */
export function BaseInstructions({
  instructions,
  control,
  state,
  renderMain,
}: {
  instructions: AgentInstructions;
  control: AgentControl;
  state: AgentControlState;
  renderMain?: (
    content: ReactNode,
    requestLeave: (leave: () => void) => void,
  ) => ReactNode;
}) {
  const proposal = useSyncExternalStore(
    instructions.subscribe,
    instructions.snapshot,
    instructions.snapshot,
  );
  const saved = state.data?.instructions;
  if (!saved || !control.adoptInstructions)
    return renderMain ? (
      <PanelFrame>{renderMain(null, (leave) => leave())}</PanelFrame>
    ) : null;
  return (
    <BaseInstructionBuilder
      proposal={proposal}
      saved={saved}
      control={control}
      state={state}
      {...(renderMain ? { renderMain } : {})}
    />
  );
}

function BaseInstructionBuilder({
  proposal,
  saved,
  control,
  state,
  renderMain,
}: {
  proposal: ReturnType<AgentInstructions["snapshot"]>;
  saved: SavedInstructions;
  control: AgentControl;
  state: AgentControlState;
  renderMain?: (
    content: ReactNode,
    requestLeave: (leave: () => void) => void,
  ) => ReactNode;
}) {
  const [draft, setDraft] = useState<MutableInstructionDraft>(() =>
    instructionDraft(saved),
  );
  const [baseRevision, setBaseRevision] = useState(saved.revision);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState<(() => void) | null>(null);
  const [focusEditorBody, setFocusEditorBody] = useState(false);
  const [deleting, setDeleting] = useState<SavedModule | null>(null);
  const [deletingCategory, setDeletingCategory] =
    useState<InstructionCategory | null>(null);
  const [openActions, setOpenActions] = useState<string | null>(null);
  const [availableOpen, setAvailableOpen] = useState(false);
  const [libraryAnchor, setLibraryAnchor] = useState<HTMLElement | null>(null);
  const [libraryFocus, setLibraryFocus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [viewMode, setViewMode] = useState<"sections" | "all">("sections");
  const board = useRef<HTMLOListElement>(null);
  const editorName = useRef<HTMLInputElement>(null);
  const pendingEditorFocus = useRef<Editor | null>(null);
  const pendingMenuEdit = useRef<SavedModule | null>(null);
  const suppressMenuFocus = useRef<string | null>(null);
  const traitTiles = useRef(new Map<string, HTMLLIElement>());
  const categoryAddAnchors = useRef(new Map<string, HTMLElement>());
  const libraryActions = useRef(new Map<string, HTMLElement>());
  const boardMetrics = useInstructionBoard(board);
  const drag = useRef<Drag | null>(null);
  const suppressEdit = useRef(false);
  const [dragOffset, setDragOffset] = useState<DragOffset | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dragging = dragOffset !== null;
  const stale = saved.revision !== baseRevision;
  const changed = instructionDraftChanged(draft, saved, proposal);
  const prepared = preparedInstructionDraft(draft, proposal);
  const prompt = instructionPrompt(
    draft.composition.categories,
    draft.composition.modules,
  );
  const estimatedTokens = estimateInstructionTokens(prompt);
  const categoriesValid = draft.composition.categories.every(
    (category) => category.title.trim() && !/[\r\n\0]/u.test(category.title),
  );
  const categorySummaries = instructionCategorySummaries(
    draft.composition.modules,
    draft.composition.categories,
  );
  const pending =
    state.data?.agents.filter(
      (agent) =>
        agent.runningInstructions &&
        agent.savedInstructions &&
        agent.runningInstructions.sha256 !== agent.savedInstructions.sha256,
    ).length ?? 0;
  const available = availableInstructionModules(draft, proposal).filter(
    (module) => module.pluginId === LOCAL_INSTRUCTIONS_PLUGIN,
  );
  const orderedModules = draft.composition.categories.flatMap((category) =>
    draft.composition.modules.filter(
      (module) => module.category === category.id,
    ),
  );
  const boardItems: Array<InstructionCategory | SavedModule> =
    viewMode === "sections"
      ? draft.composition.categories.flatMap((category) => [
          category,
          ...draft.composition.modules.filter(
            (module) => module.category === category.id,
          ),
        ])
      : orderedModules;
  const editorSource = editor
    ? sourceModule(editor.module.key, proposal)
    : undefined;
  const editorDiffersFromSource =
    editor !== null &&
    editorSource !== undefined &&
    (editor.title !== editorSource.title ||
      instructionEditorText(editor.text) !==
        instructionEditorText(editorSource.text));
  const editorChanged =
    editor !== null &&
    (editor.title !== editor.module.title ||
      editor.text !== instructionEditorText(editor.module.text));

  const mutate = (
    update: (current: MutableInstructionDraft) => MutableInstructionDraft,
  ) => {
    setDraft(update);
    setError(null);
  };
  const updateCategory = (
    id: string,
    update: (category: InstructionCategory) => InstructionCategory,
  ) =>
    mutate((current) => ({
      ...current,
      composition: {
        ...current.composition,
        categories: current.composition.categories.map((category) =>
          category.id === id ? update(category) : category,
        ),
      },
    }));
  const addCategory = () =>
    mutate((current) => ({
      ...current,
      composition: {
        ...current.composition,
        categories: [
          ...current.composition.categories,
          {
            id: `category-${globalThis.crypto.randomUUID()}`,
            title: "New category",
            tone: nextInstructionTone(current.composition.categories),
          },
        ],
      },
    }));
  const moveCategory = (id: string, offset: -1 | 1) =>
    mutate((current) => {
      const categories = [...current.composition.categories];
      const from = categories.findIndex((category) => category.id === id);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= categories.length) return current;
      const [category] = categories.splice(from, 1);
      if (!category) return current;
      categories.splice(to, 0, category);
      return {
        ...current,
        composition: { ...current.composition, categories },
      };
    });
  const requestTransition = (transition: () => void) => {
    if (editorChanged) setDiscarding(() => transition);
    else transition();
  };
  const openEditor = (
    module: SavedModule,
    location: Editor["location"],
    returnFocus?: string,
    explicitTrigger?: HTMLElement | null,
  ) => {
    const trigger =
      explicitTrigger ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    setAvailableOpen(false);
    setEditor({
      location,
      module,
      title: module.title,
      text: instructionEditorText(module.text),
      editing: location === "new",
      trigger,
      returnFocus,
    });
    setFocusEditorBody(false);
    setEditorError(null);
  };
  const edit = (
    module: SavedModule,
    location: Editor["location"],
    returnFocus?: string,
    trigger?: HTMLElement | null,
  ) =>
    requestTransition(() => openEditor(module, location, returnFocus, trigger));
  const restoreEditorFocus = (closed: Editor) => {
    pendingEditorFocus.current = closed;
  };
  const closeEditor = () =>
    requestTransition(() => {
      if (!editor) return;
      const closed = editor;
      setEditor(null);
      setEditorError(null);
      restoreEditorFocus(closed);
    });
  const returnToLibrary = () => {
    if (!editor) return;
    setLibraryFocus(editor.returnFocus ?? "new");
    setAvailableOpen(true);
    setEditor(null);
    setEditorError(null);
  };
  const cancelEditor = () => {
    if (!editor) return;
    if (editor.location === "new") {
      returnToLibrary();
      return;
    }
    setEditor({
      ...editor,
      title: editor.module.title,
      text: instructionEditorText(editor.module.text),
      editing: false,
    });
    setEditorError(null);
  };
  const addTrait = (category: string) => {
    const id = globalThis.crypto.randomUUID();
    setLibraryAnchor(categoryAddAnchors.current.get(category) ?? null);
    edit(
      {
        key: `${LOCAL_INSTRUCTIONS_PLUGIN}/${id}`,
        title: "New trait",
        pluginId: LOCAL_INSTRUCTIONS_PLUGIN,
        revision: LOCAL_INSTRUCTIONS_REVISION,
        order: draft.composition.modules.length * 10,
        category,
        text: "",
      },
      "new",
      undefined,
      categoryAddAnchors.current.get(category) ?? null,
    );
  };
  const resetAllToDefaults = () =>
    requestTransition(() => {
      setDraft(
        instructionDraft({
          revision: saved.revision,
          composition: proposal.composition,
          inactiveModules: [],
        }),
      );
      setBaseRevision(saved.revision);
      setEditor(null);
      setEditorError(null);
      setAvailableOpen(false);
      setOpenActions(null);
      setDeleting(null);
      setDeletingCategory(null);
      setError(null);
    });
  const move = (from: number, to: number, category?: string) => {
    if (
      to < 0 ||
      to >= draft.composition.modules.length ||
      (from === to && !category)
    )
      return;
    mutate((current) => {
      const modules = [...current.composition.modules];
      const [source] = modules.splice(from, 1);
      const module = source && category ? { ...source, category } : source;
      if (!module) return current;
      modules.splice(to, 0, module);
      return {
        ...current,
        composition: {
          ...current.composition,
          modules: normalizedModules(modules),
        },
      };
    });
    const module = draft.composition.modules[from];
    if (module)
      setNotice(
        `${module.title} moved to position ${to + 1} of ${draft.composition.modules.length}.`,
      );
  };
  const stopDrag = () => {
    drag.current = null;
    setDragOffset(null);
    setDropTarget(null);
  };
  useEffect(() => {
    if (!dragging) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        drag.current = null;
        setDragOffset(null);
        setDropTarget(null);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [dragging]);
  useEffect(() => {
    if (!availableOpen || editor || !libraryFocus) return;
    libraryActions.current.get(libraryFocus)?.focus();
    setLibraryFocus(null);
  }, [availableOpen, editor, libraryFocus]);
  useLayoutEffect(() => {
    const closed = pendingEditorFocus.current;
    if (editor || !closed) return;
    pendingEditorFocus.current = null;
    if (closed.trigger?.isConnected) {
      closed.trigger.focus();
      return;
    }
    if (closed.location === "active") {
      traitTiles.current
        .get(closed.module.key)
        ?.querySelector<HTMLElement>(".base-prompt-trait-open")
        ?.focus();
      return;
    }
    if (libraryAnchor?.isConnected) {
      libraryAnchor.focus();
      return;
    }
    document.getElementById("base-prompt-add-trait")?.focus();
  }, [editor, libraryAnchor]);
  const pointerDown = (
    event: ReactPointerEvent<HTMLLIElement>,
    key: string,
  ) => {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      (event.target instanceof Element &&
        event.target.closest("[data-trait-no-drag]"))
    )
      return;
    drag.current = {
      key,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
      targets: [
        ...(board.current?.querySelectorAll<HTMLElement>("[data-trait-key]") ??
          []),
      ].map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          key: element.dataset.traitKey ?? "",
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
        };
      }),
    };
  };
  const pointerMove = (event: ReactPointerEvent<HTMLOListElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const x = event.clientX - active.startX;
    const y = event.clientY - active.startY;
    if (!active.started && Math.hypot(x, y) < 6) return;
    if (!active.started) {
      const source = [...event.currentTarget.children].find(
        (element) =>
          element instanceof HTMLElement &&
          element.dataset.traitKey === active.key,
      );
      if (source instanceof HTMLElement)
        source.setPointerCapture?.(event.pointerId);
    }
    active.started = true;
    setDragOffset({ key: active.key, x, y });
    const hits =
      document.elementsFromPoint?.(event.clientX, event.clientY) ?? [];
    const hitCategory =
      viewMode === "sections"
        ? hits
            .map((element) =>
              element.closest<HTMLElement>("[data-drop-category]"),
            )
            .find((element) => element?.dataset.dropCategory)
        : undefined;
    if (hitCategory?.dataset.dropCategory) {
      const category = hitCategory.dataset.dropCategory;
      const first = draft.composition.modules.findIndex(
        (module) => module.category === category,
      );
      setDropTarget({
        index: first >= 0 ? first : draft.composition.modules.length - 1,
        category,
      });
      return;
    }
    const geometricTarget = active.targets.find(
      (target) =>
        target.key !== active.key &&
        event.clientX >= target.left &&
        event.clientX <= target.right &&
        event.clientY >= target.top &&
        event.clientY <= target.bottom,
    );
    const hitTarget = hits
      .map((element) => element.closest<HTMLElement>("[data-trait-key]"))
      .find((element) => element && element.dataset.traitKey !== active.key);
    const targetKey = geometricTarget?.key ?? hitTarget?.dataset.traitKey;
    if (!targetKey) {
      const bounds = board.current?.getBoundingClientRect();
      if (
        bounds &&
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom
      ) {
        const from = draft.composition.modules.findIndex(
          (module) => module.key === active.key,
        );
        const otherBottoms = active.targets
          .filter((target) => target.key !== active.key)
          .map((target) => target.bottom);
        const afterContent =
          otherBottoms.length > 0 && event.clientY > Math.max(...otherBottoms);
        setDropTarget({
          index: afterContent ? draft.composition.modules.length - 1 : from,
        });
      }
      return;
    }
    const index = draft.composition.modules.findIndex(
      (module) => module.key === targetKey,
    );
    if (index < 0) return;
    const source = draft.composition.modules.find(
      (module) => module.key === active.key,
    );
    const target = draft.composition.modules[index];
    if (
      viewMode === "all" &&
      source?.category !== undefined &&
      target?.category !== source.category
    ) {
      setDropTarget(null);
      return;
    }
    setDropTarget(
      viewMode === "sections" && target?.category
        ? { index, category: target.category }
        : { index },
    );
  };
  const pointerUp = (event: ReactPointerEvent<HTMLOListElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.started && dropTarget) {
      const from = draft.composition.modules.findIndex(
        (module) => module.key === active.key,
      );
      move(from, dropTarget.index, dropTarget.category);
    }
    if (active.started) {
      suppressEdit.current = true;
      window.setTimeout(() => {
        suppressEdit.current = false;
      });
    }
    stopDrag();
  };
  const saveEditor = () => {
    if (!editor) return;
    if (!editableInstructionModule(editor.module) || !editorChanged) return;
    if (!editor.title.trim()) {
      setEditorError("Give this trait a name.");
      return;
    }
    if (editor.title.includes("\0") || editor.text.includes("\0")) {
      setEditorError("Traits cannot contain null characters.");
      return;
    }
    if (!validInstructionBody(editor.text)) {
      setEditorError(
        "Invalid entry: category and item headings are generated. Remove H1–H3 headings from the instructions.",
      );
      return;
    }
    const edited = {
      ...editor.module,
      title: editor.title.trim(),
      text: editor.text.trimEnd(),
    };
    mutate((current) => {
      if (editor.location === "active")
        return {
          ...current,
          composition: {
            ...current.composition,
            modules: current.composition.modules.map((module) =>
              module.key === edited.key
                ? { ...edited, order: module.order }
                : module,
            ),
          },
        };
      if (editor.location === "new")
        return {
          ...current,
          composition: {
            ...current.composition,
            modules: normalizedModules([
              ...current.composition.modules,
              edited,
            ]),
          },
        };
      return {
        ...current,
        inactiveModules: [
          ...current.inactiveModules.filter(
            (module) => module.key !== edited.key,
          ),
          edited,
        ],
      };
    });
    setEditor({
      ...editor,
      location: editor.location === "new" ? "active" : editor.location,
      module: edited,
      title: edited.title,
      text: edited.text,
      editing: false,
    });
    setFocusEditorBody(false);
    setEditorError(null);
  };
  const editorPanel = editor ? (
    <TraitPanel autoFocusTitle={editor.location === "new"} close={closeEditor}>
      <article className="base-prompt-editor-document">
        <TraitStateDetails module={editor.module} proposal={proposal} />
        {editor.editing ? (
          <Input
            ref={editorName}
            aria-label="Trait name"
            aria-invalid={!!editorError}
            autoFocus={editor.location === "new" || !focusEditorBody}
            value={editor.title}
            onChange={(event) => {
              setEditor({ ...editor, title: event.currentTarget.value });
              setEditorError(null);
            }}
          />
        ) : (
          <button
            type="button"
            className="base-prompt-editor-title"
            disabled={!editableInstructionModule(editor.module)}
            onClick={() => {
              setFocusEditorBody(false);
              setEditor({ ...editor, editing: true });
            }}
          >
            <h1>{editor.title}</h1>
          </button>
        )}
        {editorError && (
          <p role="alert" className="m-0 text-body-sm text-danger">
            {editorError}
          </p>
        )}
        {editor.editing ? (
          <TraitBodyEditor
            value={editor.text}
            focus={focusEditorBody}
            onChange={(text) => {
              setEditor({ ...editor, text });
              setEditorError(null);
            }}
          />
        ) : (
          <TraitBody
            text={editor.text}
            editable={editableInstructionModule(editor.module)}
            onEdit={() => {
              setFocusEditorBody(true);
              setEditor({ ...editor, editing: true });
            }}
          />
        )}
        {editor.editing && (
          <footer className="base-prompt-editor-actions">
            <div>
              {editorSource && editorDiffersFromSource && (
                <Button
                  size="sm"
                  onClick={() => {
                    setEditor({
                      ...editor,
                      title: editorSource.title,
                      text: instructionEditorText(editorSource.text),
                    });
                    setEditorError(null);
                  }}
                >
                  Reset to default
                </Button>
              )}
            </div>
            <div className="base-prompt-editor-primary-actions">
              <Button onClick={cancelEditor}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!editorChanged}
                onClick={saveEditor}
              >
                Save trait
              </Button>
            </div>
          </footer>
        )}
      </article>
    </TraitPanel>
  ) : undefined;

  const builder = (
    <section className="base-prompt-builder" aria-label="Base prompt builder">
      {proposal.error && <p role="alert">{proposal.error}</p>}
      {stale && (
        <p role="alert" className="text-danger">
          The host has a newer saved base prompt. Your draft is retained; reset
          to defaults or reopen this view before applying more changes.
        </p>
      )}
      {!!prepared.unavailable.length && (
        <p role="alert" className="text-danger">
          {prepared.unavailable.map((module) => module.title).join(", ")} came
          from an unavailable plugin revision. Remove those traits or restore
          the plugin before applying.
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {!categoriesValid && (
        <p role="alert" className="text-danger">
          Category headings must be non-empty single lines.
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>

      <section className="base-prompt-stack" aria-label="Base prompt traits">
        <div className="base-prompt-toolbar">
          <section
            className="base-prompt-metrics"
            aria-labelledby="base-prompt-summary-title"
          >
            <h2 id="base-prompt-summary-title" className="sr-only">
              Base prompt summary
            </h2>
            <dl className="base-prompt-metrics-list">
              <div className="base-prompt-metric">
                <dt className="m-0 text-body-sm text-secondary">
                  Active traits
                </dt>
                <dd className="base-prompt-metric-value m-0 text-title">
                  {draft.composition.modules.length}
                </dd>
              </div>
              <div className="base-prompt-metric">
                <dt className="m-0 text-body-sm text-secondary">
                  Estimated tokens
                </dt>
                <dd className="base-prompt-metric-value m-0 text-title">
                  <span aria-hidden="true">
                    ~{formatCompactInstructionTokens(estimatedTokens)}
                  </span>
                  <span className="sr-only">
                    Approximately {estimatedTokens.toLocaleString()} tokens
                  </span>
                </dd>
              </div>
              <div className="base-prompt-metric">
                <dt className="m-0 text-body-sm text-secondary">
                  Running agents to restart
                </dt>
                <dd className="base-prompt-metric-value m-0 text-title">
                  {pending}
                </dd>
              </div>
            </dl>
          </section>
        </div>
        <Tabs
          value={viewMode}
          items={[
            { value: "sections", label: "Sections" },
            { value: "all", label: "All entries" },
          ]}
          label="Base prompt view"
          variant="panel"
          onValueChange={setViewMode}
        />
        {viewMode === "all" && (
          <ul
            className="base-prompt-category-legend text-body-sm"
            aria-label="Approximate prompt cost by category"
          >
            {categorySummaries.map((summary) => (
              <li
                key={summary.category.id}
                data-category-tone={summary.category.tone}
              >
                <span className="base-prompt-category-swatch" aria-hidden />
                <span>{summary.category.title}</span>
                <span className="text-secondary">
                  ~{summary.tokens.toLocaleString()} ·{" "}
                  {formatInstructionPercentage(summary.percentage)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <ol
          ref={board}
          className="base-prompt-board"
          data-view-mode={viewMode}
          data-has-selection={editor || availableOpen ? "true" : undefined}
          aria-label="Prompt traits in sequence"
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={stopDrag}
          style={
            {
              "--base-prompt-board-columns": boardMetrics.columns,
              "--base-prompt-board-cell": `${boardMetrics.cell}px`,
            } as BoardStyle
          }
        >
          {boardItems.map((item) => {
            if ("tone" in item) {
              const category = item;
              const categoryIndex = draft.composition.categories.findIndex(
                (candidate) => candidate.id === category.id,
              );
              const summary = categorySummaries.find(
                (candidate) => candidate.category.id === category.id,
              );
              return (
                <Fragment key={`category:${category.id}`}>
                  <li
                    className="base-prompt-category-heading"
                    data-category-tone={category.tone}
                    data-drop-category={category.id}
                    data-drop-target={
                      dropTarget?.category === category.id ? "true" : undefined
                    }
                  >
                    <MenuRoot>
                      <MenuTrigger
                        render={
                          <button
                            type="button"
                            className="base-prompt-category-color"
                            aria-label={`Change color for ${category.title}`}
                          />
                        }
                      />
                      <MenuPopup align="start" size="compact">
                        {INSTRUCTION_TONES.map((tone) => (
                          <MenuItem
                            key={tone}
                            onClick={() =>
                              updateCategory(category.id, (current) => ({
                                ...current,
                                tone,
                              }))
                            }
                          >
                            <span
                              className="base-prompt-tone-option"
                              data-category-tone={tone}
                              aria-hidden
                            />
                            {tone[0]?.toUpperCase()}
                            {tone.slice(1)}
                          </MenuItem>
                        ))}
                      </MenuPopup>
                    </MenuRoot>
                    <div className="base-prompt-category-title">
                      <Input
                        aria-label={`Category heading for ${category.title}`}
                        aria-invalid={
                          !category.title.trim() ||
                          /[\r\n\0]/u.test(category.title)
                        }
                        value={category.title}
                        onChange={(event) => {
                          const title = event.currentTarget.value;
                          updateCategory(category.id, (current) => ({
                            ...current,
                            title,
                          }));
                        }}
                      />
                    </div>
                    <span className="text-body-sm text-secondary">
                      ~{summary?.tokens.toLocaleString() ?? 0} tokens
                    </span>
                    <MenuRoot>
                      <MenuTrigger
                        render={
                          <IconButton
                            ref={(node) => {
                              if (node)
                                categoryAddAnchors.current.set(
                                  category.id,
                                  node,
                                );
                              else
                                categoryAddAnchors.current.delete(category.id);
                            }}
                            size="compact"
                            aria-label={`Add to ${category.title}`}
                            icon={<PlusIcon size={16} aria-hidden="true" />}
                          />
                        }
                      />
                      <MenuPopup align="end" size="compact">
                        <MenuItem onClick={() => addTrait(category.id)}>
                          Add trait
                        </MenuItem>
                        <MenuItem onClick={addCategory}>Add category</MenuItem>
                      </MenuPopup>
                    </MenuRoot>
                    <MenuRoot>
                      <MenuTrigger
                        render={
                          <IconButton
                            size="compact"
                            aria-label={`Actions for ${category.title}`}
                            icon={
                              <DotsThreeIcon size={16} aria-hidden="true" />
                            }
                          />
                        }
                      />
                      <MenuPopup align="end" size="compact">
                        <MenuItem
                          disabled={categoryIndex === 0}
                          onClick={() => moveCategory(category.id, -1)}
                        >
                          <MenuIcon>
                            <ArrowUpIcon size={16} />
                          </MenuIcon>
                          Move earlier
                        </MenuItem>
                        <MenuItem
                          disabled={
                            categoryIndex ===
                            draft.composition.categories.length - 1
                          }
                          onClick={() => moveCategory(category.id, 1)}
                        >
                          <MenuIcon>
                            <ArrowDownIcon size={16} />
                          </MenuIcon>
                          Move later
                        </MenuItem>
                        <MenuItem
                          tone="danger"
                          disabled={category.id === "uncategorized"}
                          onClick={() => setDeletingCategory(category)}
                        >
                          <MenuIcon>
                            <TrashIcon size={16} />
                          </MenuIcon>
                          Delete category
                        </MenuItem>
                      </MenuPopup>
                    </MenuRoot>
                  </li>
                  {!summary && (
                    <li
                      className="base-prompt-empty-category text-body-sm text-secondary"
                      data-category-tone={category.tone}
                      data-drop-category={category.id}
                      data-drop-target={
                        dropTarget?.category === category.id
                          ? "true"
                          : undefined
                      }
                      aria-label={`${category.title} is empty`}
                    >
                      Drop entries here
                    </li>
                  )}
                </Fragment>
              );
            }
            const module = item;
            const index = draft.composition.modules.findIndex(
              (candidate) => candidate.key === module.key,
            );
            const sequence =
              orderedModules.findIndex(
                (candidate) => candidate.key === module.key,
              ) + 1;
            const category = instructionCategory(
              module,
              draft.composition.categories,
            );
            const percentage = instructionPercentage(
              module.text.length,
              prompt.length,
            );
            const proportionalSpan = instructionTileSpan(
              module.text.length,
              prompt.length,
              boardMetrics.columns,
            );
            const span =
              viewMode === "all"
                ? {
                    ...proportionalSpan,
                    columns: Math.min(proportionalSpan.columns, 2),
                    rows: Math.min(proportionalSpan.rows, 2),
                  }
                : undefined;
            const offset =
              dragOffset?.key === module.key ? dragOffset : undefined;
            const editorOpen =
              editor?.location === "active" && editor.module.key === module.key;
            return (
              <li
                key={module.key}
                ref={(node) => {
                  if (node) traitTiles.current.set(module.key, node);
                  else traitTiles.current.delete(module.key);
                }}
                data-trait-key={module.key}
                data-category-tone={category.tone}
                data-trait-units={span?.units}
                data-drop-target={
                  dropTarget?.index === index && dragOffset?.key !== module.key
                    ? "true"
                    : undefined
                }
                data-dragging={offset ? "true" : undefined}
                data-selected={editorOpen ? "true" : undefined}
                {...traitStateAttributes(module, proposal)}
                className="base-prompt-trait"
                style={{
                  gridColumn: span ? `span ${span.columns}` : undefined,
                  gridRow: span ? `span ${span.rows}` : undefined,
                  transform: offset
                    ? `translate3d(${offset.x}px, ${offset.y}px, 0)`
                    : undefined,
                }}
                onPointerDown={(event) => pointerDown(event, module.key)}
              >
                <button
                  type="button"
                  className="base-prompt-trait-open"
                  aria-label={module.title}
                  onClick={(event) => {
                    if (suppressEdit.current) return;
                    if (editorOpen) closeEditor();
                    else edit(module, "active", undefined, event.currentTarget);
                  }}
                >
                  <span className="base-prompt-trait-heading">
                    <span className="base-prompt-trait-sequence text-caption">
                      {sequence}
                    </span>
                  </span>
                  <span className="base-prompt-board-title text-label">
                    {module.title}
                  </span>
                  <span className="base-prompt-trait-cost text-body-sm text-secondary">
                    ~{estimateInstructionTokens(module.text).toLocaleString()}{" "}
                    tokens · {formatInstructionPercentage(percentage)}
                  </span>
                  <span className="sr-only">{category.title} category</span>
                </button>
                <div
                  className="base-prompt-trait-actions base-prompt-board-actions"
                  data-trait-no-drag
                >
                  <MenuRoot
                    open={openActions === module.key}
                    onOpenChange={(open) =>
                      setOpenActions(open ? module.key : null)
                    }
                    onOpenChangeComplete={(open) => {
                      const pending = pendingMenuEdit.current;
                      if (!open && pending?.key === module.key) {
                        pendingMenuEdit.current = null;
                        edit(pending, "active");
                      }
                    }}
                  >
                    <MenuTrigger
                      render={
                        <IconButton
                          size="compact"
                          aria-label={`Actions for ${module.title}`}
                          icon={<DotsThreeIcon size={16} aria-hidden="true" />}
                        />
                      }
                    />
                    <MenuPopup
                      align="end"
                      size="compact"
                      data-trait-no-drag
                      finalFocus={() => {
                        if (suppressMenuFocus.current !== module.key)
                          return true;
                        suppressMenuFocus.current = null;
                        return false;
                      }}
                    >
                      <MenuItem
                        onClick={() => {
                          pendingMenuEdit.current = module;
                          suppressMenuFocus.current = module.key;
                        }}
                      >
                        <MenuIcon>
                          <PencilSimpleIcon size={16} />
                        </MenuIcon>
                        {editableInstructionModule(module) ? "Edit" : "View"}
                      </MenuItem>
                      <MenuItem
                        disabled={
                          index === 0 ||
                          draft.composition.modules[index - 1]?.category !==
                            module.category
                        }
                        onClick={() => {
                          setOpenActions(null);
                          move(index, index - 1);
                        }}
                      >
                        <MenuIcon>
                          <ArrowUpIcon size={16} />
                        </MenuIcon>
                        Move earlier
                      </MenuItem>
                      <MenuItem
                        disabled={
                          index === draft.composition.modules.length - 1 ||
                          draft.composition.modules[index + 1]?.category !==
                            module.category
                        }
                        onClick={() => {
                          setOpenActions(null);
                          move(index, index + 1);
                        }}
                      >
                        <MenuIcon>
                          <ArrowDownIcon size={16} />
                        </MenuIcon>
                        Move later
                      </MenuItem>
                      {module.pluginId === LOCAL_INSTRUCTIONS_PLUGIN && (
                        <MenuItem
                          tone="danger"
                          disabled={draft.composition.modules.length === 1}
                          onClick={() => {
                            setOpenActions(null);
                            mutate((current) => ({
                              ...current,
                              composition: {
                                ...current.composition,
                                modules: normalizedModules(
                                  current.composition.modules.filter(
                                    (candidate) => candidate.key !== module.key,
                                  ),
                                ),
                              },
                              inactiveModules: [
                                ...current.inactiveModules.filter(
                                  (candidate) => candidate.key !== module.key,
                                ),
                                module,
                              ],
                            }));
                          }}
                        >
                          <MenuIcon>
                            <TrashIcon size={16} />
                          </MenuIcon>
                          Remove
                        </MenuItem>
                      )}
                    </MenuPopup>
                  </MenuRoot>
                </div>
              </li>
            );
          })}
          <li
            className="base-prompt-add-row"
            data-selected={
              availableOpen || (editor && editor.location !== "active")
                ? "true"
                : undefined
            }
            hidden={viewMode === "sections"}
          >
            <PopoverRoot
              open={availableOpen}
              triggerId="base-prompt-add-trait"
              onOpenChange={(open) => {
                setAvailableOpen(open);
                if (!open) {
                  setLibraryAnchor(null);
                  setLibraryFocus(null);
                }
              }}
            >
              <PopoverTrigger
                id="base-prompt-add-trait"
                render={
                  <button
                    type="button"
                    className="base-prompt-add-trait"
                    aria-label="Add trait"
                    onClick={() => setLibraryAnchor(null)}
                  >
                    <PlusIcon size={24} aria-hidden="true" />
                  </button>
                }
              />
              <PopoverPopup
                side="left"
                align="end"
                anchor={libraryAnchor ?? undefined}
                finalFocus={libraryAnchor ? () => libraryAnchor : undefined}
                size="wide"
              >
                <div className="base-prompt-library-menu">
                  <div>
                    <PopoverTitle>Available traits</PopoverTitle>
                    <PopoverDescription>
                      Add defaults, reuse removed traits, or create your own.
                    </PopoverDescription>
                  </div>
                  <Button
                    ref={(node) => {
                      if (node) libraryActions.current.set("new", node);
                      else libraryActions.current.delete("new");
                    }}
                    size="sm"
                    onClick={(event) => {
                      const id = globalThis.crypto.randomUUID();
                      edit(
                        {
                          key: `${LOCAL_INSTRUCTIONS_PLUGIN}/${id}`,
                          title: "New trait",
                          pluginId: LOCAL_INSTRUCTIONS_PLUGIN,
                          revision: LOCAL_INSTRUCTIONS_REVISION,
                          order: draft.composition.modules.length * 10,
                          category: "custom",
                          text: "",
                        },
                        "new",
                        "new",
                        event.currentTarget,
                      );
                    }}
                  >
                    <PlusIcon size={16} aria-hidden="true" />
                    New trait
                  </Button>
                  {!!available.length && (
                    <ul className="base-prompt-library-list">
                      {available.map((module) => {
                        const category = instructionCategory(
                          module,
                          draft.composition.categories,
                        );
                        return (
                          <li
                            key={module.key}
                            className="base-prompt-available-trait"
                            data-category-tone={category.tone}
                            {...traitStateAttributes(module, proposal)}
                          >
                            <span
                              className="base-prompt-category-swatch"
                              aria-hidden
                            />
                            <button
                              ref={(node) => {
                                if (node)
                                  libraryActions.current.set(module.key, node);
                                else libraryActions.current.delete(module.key);
                              }}
                              type="button"
                              className="base-prompt-available-copy"
                              aria-label={module.title}
                              onClick={(event) =>
                                edit(
                                  module,
                                  "available",
                                  module.key,
                                  event.currentTarget,
                                )
                              }
                            >
                              <span className="base-prompt-trait-title text-label">
                                {module.title}
                              </span>
                              <span className="text-body-sm text-secondary">
                                {category.title} · ~
                                {estimateInstructionTokens(
                                  module.text,
                                ).toLocaleString()}{" "}
                                tokens
                              </span>
                            </button>
                            <div className="base-prompt-trait-actions">
                              {module.pluginId ===
                                LOCAL_INSTRUCTIONS_PLUGIN && (
                                <IconButton
                                  size="compact"
                                  aria-label={`Delete ${module.title}`}
                                  icon={
                                    <TrashIcon size={16} aria-hidden="true" />
                                  }
                                  onClick={() => {
                                    setAvailableOpen(false);
                                    setDeleting(module);
                                  }}
                                />
                              )}
                              <Button
                                size="sm"
                                onClick={() => {
                                  setAvailableOpen(false);
                                  mutate((current) => ({
                                    ...current,
                                    composition: {
                                      ...current.composition,
                                      modules: normalizedModules([
                                        ...current.composition.modules,
                                        module,
                                      ]),
                                    },
                                    inactiveModules:
                                      current.inactiveModules.filter(
                                        (candidate) =>
                                          candidate.key !== module.key,
                                      ),
                                  }));
                                }}
                              >
                                Add
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {!available.length && (
                    <p className="m-0 text-body-sm text-secondary">
                      Every available trait is already active.
                    </p>
                  )}
                </div>
              </PopoverPopup>
            </PopoverRoot>
          </li>
        </ol>
      </section>

      <div className="base-prompt-reset">
        <Button
          disabled={state.busy || !!proposal.error}
          onClick={resetAllToDefaults}
        >
          Reset all to default
        </Button>
      </div>

      {changed && (
        <div className="base-prompt-footer">
          <p className="m-0 text-body-sm text-secondary">
            Changes affect future starts and restarts. Running work is never
            restarted automatically.
          </p>
          <Button
            variant="primary"
            loading={state.busy}
            disabled={
              !changed ||
              stale ||
              !!proposal.error ||
              !!prepared.unavailable.length ||
              !categoriesValid ||
              !prompt.trim() ||
              state.status !== "ready"
            }
            onClick={() => {
              setError(null);
              void control
                .adoptInstructions?.(baseRevision, prepared.draft)
                .then((snapshot) => {
                  const next = snapshot.instructions;
                  if (!next) throw new Error("Missing saved instructions");
                  setDraft(instructionDraft(next));
                  setBaseRevision(next.revision);
                  setNotice(
                    "Base prompt applied. Running agents were not restarted.",
                  );
                })
                .catch(() =>
                  setError(
                    "Could not confirm the base prompt. Refresh status before retrying; your draft is retained.",
                  ),
                );
            }}
          >
            Apply base prompt
          </Button>
        </div>
      )}

      {deleting && (
        <AlertDialog
          title={`Delete ${deleting.title}?`}
          description="This permanently removes the custom trait when you apply the base prompt."
          onClose={() => setDeleting(null)}
          actions={
            <>
              <Button onClick={() => setDeleting(null)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => {
                  mutate((current) => ({
                    ...current,
                    inactiveModules: current.inactiveModules.filter(
                      (module) => module.key !== deleting.key,
                    ),
                  }));
                  setDeleting(null);
                }}
              >
                Delete trait
              </Button>
            </>
          }
        />
      )}
      {deletingCategory && (
        <AlertDialog
          title={`Delete ${deletingCategory.title}?`}
          description="Custom entries in this category will be deleted. Plugin entries will move to Uncategorized when you apply the base prompt."
          onClose={() => setDeletingCategory(null)}
          actions={
            <>
              <Button onClick={() => setDeletingCategory(null)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => {
                  mutate((current) => {
                    const keepOrRehome = (module: SavedModule) =>
                      module.category !== deletingCategory.id
                        ? module
                        : module.pluginId === LOCAL_INSTRUCTIONS_PLUGIN
                          ? null
                          : { ...module, category: "uncategorized" };
                    return {
                      ...current,
                      composition: {
                        ...current.composition,
                        categories: current.composition.categories.filter(
                          (category) => category.id !== deletingCategory.id,
                        ),
                        modules: normalizedModules(
                          current.composition.modules
                            .map(keepOrRehome)
                            .filter(
                              (module): module is SavedModule => !!module,
                            ),
                        ),
                      },
                      inactiveModules: current.inactiveModules
                        .map(keepOrRehome)
                        .filter((module): module is SavedModule => !!module),
                    };
                  });
                  setDeletingCategory(null);
                }}
              >
                Delete category
              </Button>
            </>
          }
        />
      )}
    </section>
  );
  const requestLeave = (leave: () => void) =>
    requestTransition(() => {
      setEditor(null);
      setEditorError(null);
      leave();
    });
  return (
    <>
      <PanelFrame companion={editorPanel}>
        {renderMain ? renderMain(builder, requestLeave) : builder}
      </PanelFrame>
      {discarding && editor && (
        <AlertDialog
          title={`Discard changes to ${editor.module.title}?`}
          description="Your unsaved title and instruction changes will be lost."
          onClose={() => setDiscarding(null)}
          actions={
            <>
              <Button onClick={() => setDiscarding(null)}>Keep editing</Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const transition = discarding;
                  setDiscarding(null);
                  transition();
                }}
              >
                Discard changes
              </Button>
            </>
          }
        />
      )}
    </>
  );
}

function TraitPanel({
  autoFocusTitle,
  close,
  children,
}: {
  autoFocusTitle: boolean;
  close(): void;
  children: ReactNode;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!autoFocusTitle) closeButton.current?.focus();
  }, [autoFocusTitle]);
  return (
    <Panel
      as="aside"
      aria-label="Trait"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="base-prompt-editor-panel">
        <PanelHeader
          variant="compact"
          title="Trait"
          actions={
            <IconButton
              ref={closeButton}
              size="toolbar"
              aria-label="Close trait"
              onClick={close}
              icon={<XIcon size={18} aria-hidden="true" />}
            />
          }
        />
        <div className="base-prompt-editor-scroll">{children}</div>
      </div>
    </Panel>
  );
}

function TraitBody({
  text,
  editable,
  onEdit,
}: {
  text: string;
  editable: boolean;
  onEdit(): void;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: The rendered document becomes an editor while links retain their own behavior.
    <div
      className="base-prompt-editor-markdown"
      {...(editable
        ? { role: "button", tabIndex: 0, "aria-label": "Instructions" }
        : { role: "document" })}
      onClick={(event) => {
        if (
          editable &&
          !(
            event.target instanceof Element && event.target.closest("a, button")
          )
        )
          onEdit();
      }}
      onKeyDown={(event) => {
        if (editable && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onEdit();
        }
      }}
    >
      {text ? (
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
      ) : (
        <p className="text-secondary">Click to add instructions.</p>
      )}
    </div>
  );
}

function TraitBodyEditor({
  value,
  focus,
  onChange,
}: {
  value: string;
  focus: boolean;
  onChange(value: string): void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  });
  useEffect(() => {
    const element = textarea.current;
    if (!element || !focus) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [focus]);
  return (
    <Textarea
      ref={textarea}
      aria-label="Instructions"
      variant="code"
      rows={1}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

function traitStateAttributes(
  module: SavedModule,
  proposal: ReturnType<AgentInstructions["snapshot"]>,
) {
  const state = instructionModuleState(module, proposal);
  return {
    "data-trait-origin": state.origin,
    "data-trait-modified": state.modified || undefined,
  };
}

function TraitStateDetails({
  module,
  proposal,
}: {
  module: SavedModule;
  proposal: ReturnType<AgentInstructions["snapshot"]>;
}) {
  const state = instructionModuleState(module, proposal);
  const title = originLabel(state.origin);
  const hint =
    state.origin === "custom"
      ? `${title} · This app profile`
      : `${title} · ${sourceLabel(module)}`;
  return <p className="m-0 text-body-sm text-secondary">{hint}</p>;
}

function originLabel(origin: InstructionModuleState["origin"]) {
  if (origin === "default") return "Default trait";
  if (origin === "plugin") return "Plugin trait";
  return "Custom trait";
}

function sourceLabel(module: SavedModule) {
  return module.pluginId === DEFAULT_INSTRUCTIONS_PLUGIN
    ? "Buzz defaults"
    : module.pluginId;
}

function formatInstructionPercentage(percentage: number) {
  if (percentage > 0 && percentage < 1) return "<1%";
  return `${Math.round(percentage)}%`;
}

function formatCompactInstructionTokens(tokens: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(tokens);
}

function useInstructionBoard(board: RefObject<HTMLOListElement | null>) {
  const [metrics, setMetrics] = useState({ columns: 6, cell: 96 });
  useEffect(() => {
    const element = board.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      if (!width) return;
      const columns = instructionBoardColumns(width);
      const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 8;
      const cell = Math.max(1, (width - gap * (columns - 1)) / columns);
      setMetrics((current) =>
        current.columns === columns && Math.abs(current.cell - cell) < 0.5
          ? current
          : { columns, cell },
      );
    };
    measure();
    if (!globalThis.ResizeObserver) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [board]);
  return metrics;
}
