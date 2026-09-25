import {
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
  SavedInstructions,
  SavedModule,
} from "../../features/agent-instructions/service";
import type {
  AgentControl,
  AgentControlState,
} from "../../features/agents/control";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChatCircleIcon,
  DotsThreeIcon,
  FileTextIcon,
  GitBranchIcon,
  PencilSimpleIcon,
  PlusIcon,
  SquaresFourIcon,
  TrashIcon,
  UserIcon,
  WrenchIcon,
} from "../../shared/design-system/icons";
import { AlertDialog } from "../../shared/design-system/ui/AlertDialog";
import { Button } from "../../shared/design-system/ui/Button";
import { Dialog } from "../../shared/design-system/ui/Dialog";
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
  PopoverDescription,
  PopoverPopup,
  PopoverRoot,
  PopoverTitle,
  PopoverTrigger,
} from "../../shared/design-system/ui/Popover";
import { Textarea } from "../../shared/design-system/ui/Textarea";
import {
  availableInstructionModules,
  DEFAULT_INSTRUCTIONS_PLUGIN,
  estimateInstructionTokens,
  instructionBoardColumns,
  instructionCategory,
  instructionCategorySummaries,
  instructionEditorText,
  instructionDraft,
  instructionDraftChanged,
  instructionModuleState,
  instructionPercentage,
  instructionTextWithBoundary,
  instructionTileSpan,
  LOCAL_INSTRUCTIONS_PLUGIN,
  LOCAL_INSTRUCTIONS_REVISION,
  normalizedModules,
  preparedInstructionDraft,
  sourceModule,
  type InstructionCategory,
  type InstructionModuleState,
  type MutableInstructionDraft,
} from "./base-instruction-draft";

type Editor = {
  location: "active" | "available" | "new";
  module: SavedModule;
  title: string;
  text: string;
  dirty: boolean;
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
type BoardStyle = CSSProperties & {
  "--base-prompt-board-columns": number;
  "--base-prompt-board-cell": string;
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
  const [openActions, setOpenActions] = useState<string | null>(null);
  const [availableOpen, setAvailableOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const board = useRef<HTMLOListElement>(null);
  const boardMetrics = useInstructionBoard(board);
  const drag = useRef<Drag | null>(null);
  const suppressEdit = useRef(false);
  const [dragOffset, setDragOffset] = useState<DragOffset | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dragging = dragOffset !== null;
  const stale = saved.revision !== baseRevision;
  const changed = instructionDraftChanged(draft, saved, proposal);
  const prepared = preparedInstructionDraft(draft, proposal);
  const prompt = draft.composition.modules
    .map((module) => module.text)
    .join("");
  const estimatedTokens = estimateInstructionTokens(prompt);
  const categorySummaries = instructionCategorySummaries(
    draft.composition.modules,
  );
  const pending =
    state.data?.agents.filter(
      (agent) =>
        agent.runningInstructions &&
        agent.runningInstructions.revision !== saved.revision,
    ).length ?? 0;
  const available = availableInstructionModules(draft, proposal);
  const editorSource = editor
    ? sourceModule(editor.module.key, proposal)
    : undefined;

  const mutate = (
    update: (current: MutableInstructionDraft) => MutableInstructionDraft,
  ) => {
    setDraft(update);
    setError(null);
  };
  const edit = (module: SavedModule, location: Editor["location"]) => {
    setEditor({
      location,
      module,
      title: module.title,
      text: module.text,
      dirty: false,
    });
    setEditorError(null);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.composition.modules.length || from === to) return;
    mutate((current) => {
      const modules = [...current.composition.modules];
      const [module] = modules.splice(from, 1);
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
    setDropAt(null);
  };
  useEffect(() => {
    if (!dragging) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        drag.current = null;
        setDragOffset(null);
        setDropAt(null);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [dragging]);
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
    const geometricTarget = active.targets.find(
      (target) =>
        target.key !== active.key &&
        event.clientX >= target.left &&
        event.clientX <= target.right &&
        event.clientY >= target.top &&
        event.clientY <= target.bottom,
    );
    const hitTarget = document
      .elementsFromPoint?.(event.clientX, event.clientY)
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
        setDropAt(afterContent ? draft.composition.modules.length - 1 : from);
      }
      return;
    }
    const index = draft.composition.modules.findIndex(
      (module) => module.key === targetKey,
    );
    if (index < 0) return;
    setDropAt(index);
  };
  const pointerUp = (event: ReactPointerEvent<HTMLOListElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.started && dropAt !== null) {
      const from = draft.composition.modules.findIndex(
        (module) => module.key === active.key,
      );
      move(from, dropAt);
    }
    if (active.started) {
      suppressEdit.current = true;
      window.setTimeout(() => {
        suppressEdit.current = false;
      });
    }
    stopDrag();
  };

  return (
    <section className="base-prompt-builder" aria-label="Base prompt builder">
      {proposal.error && <p role="alert">{proposal.error}</p>}
      {stale && (
        <p role="alert" className="text-danger">
          The host has a newer saved base prompt. Your draft is retained;
          discard it to load the latest revision before applying more changes.
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
          <PopoverRoot open={availableOpen} onOpenChange={setAvailableOpen}>
            <div className="base-prompt-add-trait">
              <PopoverTrigger
                render={
                  <IconButton
                    size="compact"
                    aria-label="Add trait"
                    title="Add trait"
                    icon={<PlusIcon size={16} aria-hidden="true" />}
                  />
                }
              />
            </div>
            <PopoverPopup align="end" size="wide">
              <div className="base-prompt-library-menu">
                <div>
                  <PopoverTitle>Available traits</PopoverTitle>
                  <PopoverDescription>
                    Add defaults, reuse removed traits, or create your own.
                  </PopoverDescription>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setAvailableOpen(false);
                    const id = globalThis.crypto.randomUUID();
                    edit(
                      {
                        key: `${LOCAL_INSTRUCTIONS_PLUGIN}/${id}`,
                        title: "New trait",
                        pluginId: LOCAL_INSTRUCTIONS_PLUGIN,
                        revision: LOCAL_INSTRUCTIONS_REVISION,
                        order: draft.composition.modules.length * 10,
                        text: "",
                      },
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
                      const category = instructionCategory(module);
                      return (
                        <li
                          key={module.key}
                          className="base-prompt-available-trait"
                          data-trait-category={categoryKey(category)}
                          {...traitStateAttributes(module, proposal)}
                        >
                          <span
                            className="base-prompt-category-swatch"
                            aria-hidden
                          />
                          <TraitCategoryIcon
                            category={category}
                            state={instructionModuleState(module, proposal)}
                          />
                          <button
                            type="button"
                            className="base-prompt-available-copy"
                            aria-label={module.title}
                            onClick={() => {
                              setAvailableOpen(false);
                              edit(module, "available");
                            }}
                          >
                            <span className="base-prompt-trait-title text-label">
                              {module.title}
                            </span>
                            <span className="text-body-sm text-secondary">
                              {category} · ~
                              {estimateInstructionTokens(
                                module.text,
                              ).toLocaleString()}{" "}
                              tokens
                            </span>
                          </button>
                          <div className="base-prompt-trait-actions">
                            {module.pluginId === LOCAL_INSTRUCTIONS_PLUGIN && (
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
        </div>
        <ul
          className="base-prompt-category-legend text-body-sm"
          aria-label="Approximate prompt cost by category"
        >
          {categorySummaries.map((summary) => (
            <li
              key={summary.category}
              data-trait-category={categoryKey(summary.category)}
            >
              <span className="base-prompt-category-swatch" aria-hidden />
              <span>{summary.category}</span>
              <span className="text-secondary">
                ~{summary.tokens.toLocaleString()} ·{" "}
                {formatInstructionPercentage(summary.percentage)}
              </span>
            </li>
          ))}
        </ul>
        <ol
          ref={board}
          className="base-prompt-board"
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
          {draft.composition.modules.map((module, index) => {
            const category = instructionCategory(module);
            const percentage = instructionPercentage(
              module.text.length,
              prompt.length,
            );
            const span = instructionTileSpan(
              module.text.length,
              prompt.length,
              boardMetrics.columns,
            );
            const offset =
              dragOffset?.key === module.key ? dragOffset : undefined;
            return (
              <li
                key={module.key}
                data-trait-key={module.key}
                data-trait-category={categoryKey(category)}
                data-trait-units={span.units}
                data-drop-target={
                  dropAt === index && dragOffset?.key !== module.key
                    ? "true"
                    : undefined
                }
                data-dragging={offset ? "true" : undefined}
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
                <button
                  type="button"
                  className="base-prompt-trait-open"
                  aria-label={module.title}
                  onClick={() => {
                    if (!suppressEdit.current) edit(module, "active");
                  }}
                >
                  <span className="base-prompt-trait-heading">
                    <span className="base-prompt-trait-sequence text-caption">
                      {index + 1}
                    </span>
                    <TraitCategoryIcon
                      category={category}
                      state={instructionModuleState(module, proposal)}
                    />
                  </span>
                  <span className="base-prompt-board-title text-label">
                    {module.title}
                  </span>
                  <span className="base-prompt-trait-cost text-body-sm text-secondary">
                    ~{estimateInstructionTokens(module.text).toLocaleString()}{" "}
                    tokens · {formatInstructionPercentage(percentage)}
                  </span>
                  <span className="sr-only">{category} category</span>
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
                    <MenuPopup align="end" size="compact" data-trait-no-drag>
                      <MenuItem
                        onClick={() => {
                          setOpenActions(null);
                          edit(module, "active");
                        }}
                      >
                        <MenuIcon>
                          <PencilSimpleIcon size={16} />
                        </MenuIcon>
                        Edit
                      </MenuItem>
                      <MenuItem
                        disabled={index === 0}
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
                          index === draft.composition.modules.length - 1
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
                    </MenuPopup>
                  </MenuRoot>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="base-prompt-footer">
        <p className="m-0 text-body-sm text-secondary">
          Changes affect future starts and restarts. Running work is never
          restarted automatically.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!changed || state.busy}
            onClick={() => {
              setDraft(instructionDraft(saved));
              setBaseRevision(saved.revision);
              setError(null);
            }}
          >
            Discard changes
          </Button>
          <Button
            variant="primary"
            loading={state.busy}
            disabled={
              !changed ||
              stale ||
              !!proposal.error ||
              !!prepared.unavailable.length ||
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
      </div>

      {editor && (
        <Dialog
          open
          size="expanded"
          title={
            editor.location === "new"
              ? "Create trait"
              : `Edit ${editor.module.title}`
          }
          description="Edit the trait name and the Markdown instructions added to the shared base prompt."
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          actions={
            <>
              {editorSource && (
                <Button
                  onClick={() => {
                    setEditor({
                      ...editor,
                      module: {
                        ...editorSource,
                        order: editor.module.order,
                      },
                      title: editorSource.title,
                      text: editorSource.text,
                      dirty: false,
                    });
                    setEditorError(null);
                  }}
                >
                  Reset to default
                </Button>
              )}
              <Button onClick={() => setEditor(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (!editor.title.trim()) {
                    setEditorError("Give this trait a name.");
                    return;
                  }
                  if (
                    editor.title.includes("\0") ||
                    editor.text.includes("\0")
                  ) {
                    setEditorError("Traits cannot contain null characters.");
                    return;
                  }
                  const edited = {
                    ...editor.module,
                    title: editor.title.trim(),
                    text: instructionTextWithBoundary(
                      editor.text,
                      editor.module.text,
                    ),
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
                  setEditor(null);
                }}
              >
                Save trait
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <TraitStateDetails module={editor.module} proposal={proposal} />
            <Field label="Trait name" error={editorError}>
              <Input
                autoFocus
                value={editor.title}
                onChange={(event) => {
                  setEditor({ ...editor, title: event.currentTarget.value });
                  setEditorError(null);
                }}
              />
            </Field>
            <Field
              label="Instructions"
              description="Trailing blank lines are hidden while editing."
            >
              <Textarea
                variant="code"
                rows={18}
                value={
                  editor.dirty
                    ? editor.text
                    : instructionEditorText(editor.text)
                }
                onChange={(event) =>
                  setEditor({
                    ...editor,
                    text: event.currentTarget.value,
                    dirty: true,
                  })
                }
              />
            </Field>
          </div>
        </Dialog>
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
    </section>
  );
}

function TraitCategoryIcon({
  category,
  state,
}: {
  category: InstructionCategory;
  state: InstructionModuleState;
}) {
  const Icon =
    category === "Core"
      ? FileTextIcon
      : category === "Capabilities"
        ? WrenchIcon
        : category === "Communication"
          ? ChatCircleIcon
          : category === "Practice"
            ? GitBranchIcon
            : category === "Plugin"
              ? SquaresFourIcon
              : UserIcon;
  const label = `${category} category${state.modified ? ", modified" : ""}`;
  return (
    <span
      className="base-prompt-trait-state"
      data-trait-category={categoryKey(category)}
      data-trait-modified={state.modified || undefined}
      role="img"
      aria-label={label}
    >
      <Icon size={16} aria-hidden="true" />
      {state.modified && (
        <PencilSimpleIcon
          className="base-prompt-trait-modified"
          size={10}
          aria-hidden="true"
        />
      )}
    </span>
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
  const category = instructionCategory(module);
  const title = `${state.modified ? "Modified " : ""}${originLabel(state.origin)}`;
  const detail =
    state.origin === "custom"
      ? "Created in this app profile."
      : state.source === "unavailable"
        ? `${sourceLabel(module)} The saved source revision is unavailable.`
        : state.modified
          ? `${sourceLabel(module)} Differs from the current source.`
          : `${sourceLabel(module)} Matches the current source.`;
  return (
    <div className="base-prompt-trait-details">
      <TraitCategoryIcon category={category} state={state} />
      <div className="min-w-0">
        <p className="m-0 text-label">{title}</p>
        <p className="m-0 text-body-sm text-secondary">{detail}</p>
      </div>
    </div>
  );
}

function originLabel(origin: InstructionModuleState["origin"]) {
  if (origin === "default") return "Default trait";
  if (origin === "plugin") return "Plugin trait";
  return "Custom trait";
}

function sourceLabel(module: SavedModule) {
  return module.pluginId === DEFAULT_INSTRUCTIONS_PLUGIN
    ? "Source: Buzz defaults."
    : `Source: ${module.pluginId}.`;
}

function categoryKey(category: InstructionCategory) {
  return category.toLowerCase();
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
