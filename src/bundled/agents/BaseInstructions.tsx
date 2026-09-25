import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
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
import { Field } from "../../shared/design-system/ui/Field";
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
  PopoverClose,
  PopoverDescription,
  PopoverPopup,
  PopoverRoot,
  PopoverTitle,
  PopoverTrigger,
} from "../../shared/design-system/ui/Popover";
import { Textarea } from "../../shared/design-system/ui/Textarea";
import { Tabs } from "../../shared/design-system/ui/Tabs";
import { Select } from "../../shared/design-system/ui/Select";
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
  dirty: boolean;
  side: "left" | "right";
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
  "--base-prompt-section-row": string;
};

/** Global profile editor. Drafts remain local until one CAS-pinned adoption. */
export function BaseInstructions({
  instructions,
  control,
  state,
}: {
  instructions: AgentInstructions;
  control: AgentControl;
  state: AgentControlState;
}) {
  const proposal = useSyncExternalStore(
    instructions.subscribe,
    instructions.snapshot,
    instructions.snapshot,
  );
  const saved = state.data?.instructions;
  if (!saved || !control.adoptInstructions) return null;
  return (
    <BaseInstructionBuilder
      proposal={proposal}
      saved={saved}
      control={control}
      state={state}
    />
  );
}

function BaseInstructionBuilder({
  proposal,
  saved,
  control,
  state,
}: {
  proposal: ReturnType<AgentInstructions["snapshot"]>;
  saved: SavedInstructions;
  control: AgentControl;
  state: AgentControlState;
}) {
  const [draft, setDraft] = useState<MutableInstructionDraft>(() =>
    instructionDraft(saved),
  );
  const [baseRevision, setBaseRevision] = useState(saved.revision);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
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
  const pendingMenuEdit = useRef<SavedModule | null>(null);
  const suppressMenuFocus = useRef<string | null>(null);
  const switchingView = useRef(false);
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
  const addTrait = (category: string) => {
    const id = globalThis.crypto.randomUUID();
    setLibraryAnchor(categoryAddAnchors.current.get(category) ?? null);
    setAvailableOpen(true);
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
    );
  };
  const resetAllToDefaults = () => {
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
  };
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
  const traitSide = (key: string) => {
    const tile = traitTiles.current.get(key);
    const list = board.current;
    if (!tile || !list) return "right";
    const tileBounds = tile.getBoundingClientRect();
    const boardBounds = list.getBoundingClientRect();
    return tileBounds.left + tileBounds.width / 2 <=
      boardBounds.left + boardBounds.width / 2
      ? "right"
      : "left";
  };
  const edit = (
    module: SavedModule,
    location: Editor["location"],
    returnFocus?: string,
  ) => {
    setEditor({
      location,
      module,
      title: module.title,
      text: module.text,
      dirty: false,
      side: location === "active" ? traitSide(module.key) : "left",
      returnFocus,
    });
    setEditorError(null);
  };
  const returnToLibrary = () => {
    if (!editor) return;
    setLibraryFocus(editor.returnFocus ?? "new");
    setEditor(null);
    setEditorError(null);
  };
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
    if (!editableInstructionModule(editor.module)) {
      setEditor(null);
      return;
    }
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
    if (editor.location === "available") {
      returnToLibrary();
      return;
    }
    if (editor.location === "new") setAvailableOpen(false);
    setEditor(null);
  };
  const editorPanel = editor && (
    <div className="base-prompt-editor" data-trait-no-drag>
      <header className="base-prompt-editor-header">
        <div className="min-w-0">
          <PopoverTitle>
            {editor.location === "new"
              ? "Create trait"
              : `Edit ${editor.module.title}`}
          </PopoverTitle>
          <PopoverDescription>
            {editableInstructionModule(editor.module)
              ? "Edit the trait name and body-only Markdown added to the shared base prompt."
              : "Plugin instructions are read-only. Organize them from the category board."}
          </PopoverDescription>
        </div>
        <PopoverClose
          render={
            <IconButton
              aria-label="Close"
              size="compact"
              icon={<XIcon size={16} aria-hidden="true" />}
            />
          }
        />
      </header>
      <div className="base-prompt-editor-fields">
        <TraitStateDetails module={editor.module} proposal={proposal} />
        {editor.module.pluginId === LOCAL_INSTRUCTIONS_PLUGIN && (
          <Select
            label="Category"
            variant="field"
            value={editor.module.category ?? "custom"}
            groups={[
              {
                label: "Categories",
                options: draft.composition.categories.map((category) => ({
                  value: category.id,
                  label: category.title,
                })),
              },
            ]}
            onValueChange={(category) =>
              setEditor({
                ...editor,
                module: { ...editor.module, category },
              })
            }
          />
        )}
        <Field label="Trait name" error={editorError}>
          <Input
            ref={editorName}
            autoFocus
            disabled={!editableInstructionModule(editor.module)}
            textSize="large"
            value={editor.title}
            onChange={(event) => {
              setEditor({ ...editor, title: event.currentTarget.value });
              setEditorError(null);
            }}
          />
        </Field>
        <Field label="Instructions">
          <div className="base-prompt-editor-instructions">
            <Textarea
              variant="code"
              textSize="large"
              rows={18}
              disabled={!editableInstructionModule(editor.module)}
              value={
                editor.dirty ? editor.text : instructionEditorText(editor.text)
              }
              onChange={(event) =>
                setEditor({
                  ...editor,
                  text: event.currentTarget.value,
                  dirty: true,
                })
              }
            />
            {editorSource &&
              editableInstructionModule(editor.module) &&
              editorDiffersFromSource && (
                <button
                  type="button"
                  className="base-prompt-editor-reset text-caption"
                  onClick={() => {
                    setEditor({
                      ...editor,
                      module: {
                        ...editorSource,
                        order: editor.module.order,
                        category:
                          editor.module.category ??
                          editorSource.category ??
                          "uncategorized",
                      },
                      title: editorSource.title,
                      text: editorSource.text,
                      dirty: false,
                    });
                    setEditorError(null);
                  }}
                >
                  Reset to default
                </button>
              )}
          </div>
        </Field>
      </div>
      <footer className="base-prompt-editor-actions">
        <Button
          onClick={() => {
            if (editor.location === "active") setEditor(null);
            else returnToLibrary();
          }}
        >
          Cancel
        </Button>
        {editableInstructionModule(editor.module) && (
          <Button variant="primary" onClick={saveEditor}>
            Save trait
          </Button>
        )}
      </footer>
    </div>
  );

  return (
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
        <div
          onPointerDownCapture={(event) => {
            const value =
              event.target instanceof Element
                ? event.target.closest<HTMLElement>("[data-tab-value]")?.dataset
                    .tabValue
                : undefined;
            if (value && value !== viewMode) switchingView.current = true;
          }}
        >
          <Tabs
            value={viewMode}
            items={[
              { value: "sections", label: "Sections" },
              { value: "all", label: "All entries" },
            ]}
            label="Base prompt view"
            variant="panel"
            onValueChange={(value) => {
              switchingView.current = true;
              setViewMode(value);
              window.setTimeout(() => {
                switchingView.current = false;
              });
            }}
          />
        </div>
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
          data-has-selection={
            editor?.location === "active" || availableOpen ? "true" : undefined
          }
          aria-label="Prompt traits in sequence"
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={stopDrag}
          style={
            {
              "--base-prompt-board-columns": boardMetrics.columns,
              "--base-prompt-board-cell": `${boardMetrics.cell}px`,
              "--base-prompt-section-row": `${Math.min(
                56,
                boardMetrics.cell / 2,
              )}px`,
            } as BoardStyle
          }
        >
          {boardItems.map((item, boardIndex) => {
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
            const span = {
              ...proportionalSpan,
              columns:
                viewMode === "sections"
                  ? 1
                  : Math.min(proportionalSpan.columns, 2),
              rows:
                viewMode === "sections"
                  ? 2
                  : Math.min(proportionalSpan.rows, 2),
            };
            const offset =
              dragOffset?.key === module.key ? dragOffset : undefined;
            const editorOpen =
              editor?.location === "active" && editor.module.key === module.key;
            const triggerId = `base-prompt-trait-${boardIndex}`;
            return (
              <li
                key={module.key}
                ref={(node) => {
                  if (node) traitTiles.current.set(module.key, node);
                  else traitTiles.current.delete(module.key);
                }}
                data-trait-key={module.key}
                data-category-tone={category.tone}
                data-trait-units={span.units}
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
                  gridColumn: `span ${span.columns}`,
                  gridRow: `span ${span.rows}`,
                  transform: offset
                    ? `translate3d(${offset.x}px, ${offset.y}px, 0)`
                    : undefined,
                }}
                onPointerDown={(event) => pointerDown(event, module.key)}
              >
                <PopoverRoot
                  open={editorOpen}
                  triggerId={triggerId}
                  onOpenChange={(open, details) => {
                    if (open) {
                      if (suppressEdit.current) {
                        details.cancel();
                        return;
                      }
                      edit(module, "active");
                    } else if (editorOpen && !switchingView.current) {
                      setEditor(null);
                    }
                  }}
                >
                  <PopoverTrigger
                    id={triggerId}
                    render={
                      <button
                        type="button"
                        className="base-prompt-trait-open"
                        aria-label={module.title}
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
                          ~
                          {estimateInstructionTokens(
                            module.text,
                          ).toLocaleString()}{" "}
                          tokens · {formatInstructionPercentage(percentage)}
                        </span>
                        <span className="sr-only">
                          {category.title} category
                        </span>
                      </button>
                    }
                  />
                  {editorOpen && (
                    <PopoverPopup
                      data-base-prompt-editor=""
                      side={editor.side}
                      align="start"
                      size="wide"
                      initialFocus={editorName}
                    >
                      {editorPanel}
                    </PopoverPopup>
                  )}
                </PopoverRoot>
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
            data-selected={availableOpen ? "true" : undefined}
            hidden={viewMode === "sections"}
          >
            <PopoverRoot
              open={availableOpen}
              triggerId="base-prompt-add-trait"
              onOpenChange={(open) => {
                setAvailableOpen(open);
                if (!open && editor?.location !== "active") {
                  setLibraryAnchor(null);
                  setEditor(null);
                  setEditorError(null);
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
                data-base-prompt-editor={
                  editor && editor.location !== "active" ? "" : undefined
                }
                side="left"
                align="end"
                anchor={libraryAnchor ?? undefined}
                finalFocus={libraryAnchor ? () => libraryAnchor : undefined}
                size="wide"
                initialFocus={
                  editor && editor.location !== "active"
                    ? editorName
                    : undefined
                }
              >
                {editor && editor.location !== "active" ? (
                  editorPanel
                ) : (
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
                      onClick={() => {
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
                                    libraryActions.current.set(
                                      module.key,
                                      node,
                                    );
                                  else
                                    libraryActions.current.delete(module.key);
                                }}
                                type="button"
                                className="base-prompt-available-copy"
                                aria-label={module.title}
                                onClick={() =>
                                  edit(module, "available", module.key)
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
                )}
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
