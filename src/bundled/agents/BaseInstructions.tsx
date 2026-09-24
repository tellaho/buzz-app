import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
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
  DotsSixVerticalIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "../../shared/design-system/icons";
import { AlertDialog } from "../../shared/design-system/ui/AlertDialog";
import { Button } from "../../shared/design-system/ui/Button";
import { Dialog } from "../../shared/design-system/ui/Dialog";
import { Field } from "../../shared/design-system/ui/Field";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { Input } from "../../shared/design-system/ui/Input";
import { Textarea } from "../../shared/design-system/ui/Textarea";
import {
  availableInstructionModules,
  instructionDraft,
  instructionDraftChanged,
  instructionGroup,
  LOCAL_INSTRUCTIONS_PLUGIN,
  LOCAL_INSTRUCTIONS_REVISION,
  normalizedModules,
  preparedInstructionDraft,
  sourceModule,
  type MutableInstructionDraft,
} from "./base-instruction-draft";

type Editor = {
  location: "active" | "available" | "new";
  module: SavedModule;
  title: string;
  text: string;
};
type Drag = {
  key: string;
  pointerId: number;
  startY: number;
  started: boolean;
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const drag = useRef<Drag | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const stale = saved.revision !== baseRevision;
  const changed = instructionDraftChanged(draft, saved, proposal);
  const prepared = preparedInstructionDraft(draft, proposal);
  const prompt = draft.composition.modules
    .map((module) => module.text)
    .join("");
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
  const groups = new Map<string, SavedModule[]>();
  for (const module of available) {
    const group = instructionGroup(module);
    groups.set(group, [...(groups.get(group) ?? []), module]);
  }

  const mutate = (
    update: (current: MutableInstructionDraft) => MutableInstructionDraft,
  ) => {
    setDraft(update);
    setError(null);
  };
  const edit = (module: SavedModule, location: Editor["location"]) => {
    setEditor({ location, module, title: module.title, text: module.text });
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
    setDropAt(null);
  };
  useEffect(() => {
    if (dropAt === null) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        drag.current = null;
        setDropAt(null);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [dropAt]);
  const pointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    key: string,
  ) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      key,
      pointerId: event.pointerId,
      startY: event.clientY,
      started: false,
    };
  };
  const pointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!active.started && Math.abs(event.clientY - active.startY) < 5) return;
    active.started = true;
    const row = document
      .elementsFromPoint(event.clientX, event.clientY)
      .map((element) => element.closest<HTMLElement>("[data-trait-key]"))
      .find(Boolean);
    if (!row) {
      setDropAt(draft.composition.modules.length);
      return;
    }
    const index = draft.composition.modules.findIndex(
      (module) => module.key === row.dataset.traitKey,
    );
    if (index < 0) return;
    setDropAt(
      event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2
        ? index + 1
        : index,
    );
  };
  const pointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.started && dropAt !== null) {
      const from = draft.composition.modules.findIndex(
        (module) => module.key === active.key,
      );
      let to = dropAt;
      if (to > from) to -= 1;
      move(
        from,
        Math.max(0, Math.min(to, draft.composition.modules.length - 1)),
      );
    }
    stopDrag();
  };

  return (
    <section className="base-prompt-builder" aria-label="Base prompt builder">
      <div className="base-prompt-summary">
        <div>
          <h2 className="m-0 text-heading">Build your base prompt</h2>
          <p className="m-0 text-body-sm text-secondary">
            Shape the shared traits and behaviors used by every local agent.
          </p>
        </div>
        <p className="m-0 text-body-sm text-secondary" role="status">
          Saved revision {saved.revision} · approximately{" "}
          {Math.ceil(prompt.length / 4).toLocaleString()} tokens · {pending}{" "}
          running {pending === 1 ? "agent needs" : "agents need"} restart
        </p>
      </div>

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

      <div className="base-prompt-columns">
        <section
          className="base-prompt-stack"
          aria-labelledby="active-traits-title"
        >
          <div className="base-prompt-section-heading">
            <div>
              <h3 id="active-traits-title" className="m-0 text-label">
                Your base prompt
              </h3>
              <p className="m-0 text-body-sm text-secondary">
                {draft.composition.modules.length} active traits
              </p>
            </div>
          </div>
          <ol className="base-prompt-list">
            {draft.composition.modules.map((module, index) => (
              <li
                key={module.key}
                data-trait-key={module.key}
                data-drop-before={dropAt === index || undefined}
                className="base-prompt-trait"
              >
                <IconButton
                  size="compact"
                  aria-label={`Drag ${module.title} to reorder`}
                  title={`Drag ${module.title} to reorder`}
                  icon={<DotsSixVerticalIcon size={16} aria-hidden="true" />}
                  onPointerDown={(event) => pointerDown(event, module.key)}
                  onPointerMove={pointerMove}
                  onPointerUp={pointerUp}
                  onPointerCancel={stopDrag}
                />
                <TraitText module={module} />
                <div className="base-prompt-trait-actions">
                  <IconButton
                    size="compact"
                    aria-label={`Move ${module.title} up`}
                    disabled={index === 0}
                    icon={<ArrowUpIcon size={16} aria-hidden="true" />}
                    onClick={() => move(index, index - 1)}
                  />
                  <IconButton
                    size="compact"
                    aria-label={`Move ${module.title} down`}
                    disabled={index === draft.composition.modules.length - 1}
                    icon={<ArrowDownIcon size={16} aria-hidden="true" />}
                    onClick={() => move(index, index + 1)}
                  />
                  <IconButton
                    size="compact"
                    aria-label={`Edit ${module.title}`}
                    icon={<PencilSimpleIcon size={16} aria-hidden="true" />}
                    onClick={() => edit(module, "active")}
                  />
                  <IconButton
                    size="compact"
                    aria-label={`Remove ${module.title}`}
                    disabled={draft.composition.modules.length === 1}
                    icon={<TrashIcon size={16} aria-hidden="true" />}
                    onClick={() =>
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
                      }))
                    }
                  />
                </div>
              </li>
            ))}
            {dropAt === draft.composition.modules.length && (
              <li className="base-prompt-drop-end" aria-hidden="true" />
            )}
          </ol>
        </section>

        <section
          className="base-prompt-library"
          aria-labelledby="available-traits-title"
        >
          <div className="base-prompt-section-heading">
            <div>
              <h3 id="available-traits-title" className="m-0 text-label">
                Available traits
              </h3>
              <p className="m-0 text-body-sm text-secondary">
                Add defaults or reuse traits you removed.
              </p>
            </div>
            <Button
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
                    text: "",
                  },
                  "new",
                );
              }}
            >
              <PlusIcon size={16} aria-hidden="true" />
              New trait
            </Button>
          </div>
          {[...groups].map(([group, modules]) => (
            <section key={group} className="base-prompt-library-group">
              <h4 className="m-0 text-body-sm text-secondary">{group}</h4>
              <ul className="base-prompt-library-list">
                {modules.map((module) => (
                  <li key={module.key} className="base-prompt-available-trait">
                    <TraitText module={module} />
                    <div className="base-prompt-trait-actions">
                      <IconButton
                        size="compact"
                        aria-label={`Edit ${module.title}`}
                        icon={<PencilSimpleIcon size={16} aria-hidden="true" />}
                        onClick={() => edit(module, "available")}
                      />
                      {module.pluginId === LOCAL_INSTRUCTIONS_PLUGIN && (
                        <IconButton
                          size="compact"
                          aria-label={`Delete ${module.title}`}
                          icon={<TrashIcon size={16} aria-hidden="true" />}
                          onClick={() => setDeleting(module)}
                        />
                      )}
                      <Button
                        size="sm"
                        onClick={() =>
                          mutate((current) => ({
                            ...current,
                            composition: {
                              ...current.composition,
                              modules: normalizedModules([
                                ...current.composition.modules,
                                module,
                              ]),
                            },
                            inactiveModules: current.inactiveModules.filter(
                              (candidate) => candidate.key !== module.key,
                            ),
                          }))
                        }
                      >
                        Add
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!available.length && (
            <p className="m-0 text-body-sm text-secondary">
              Every available trait is already active.
            </p>
          )}
        </section>
      </div>

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
                    text: editor.text,
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
              description="Markdown is passed to agents exactly as written."
            >
              <Textarea
                variant="code"
                rows={18}
                value={editor.text}
                onChange={(event) =>
                  setEditor({ ...editor, text: event.currentTarget.value })
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

function TraitText({ module }: { module: SavedModule }) {
  const summary = module.text
    .replace(/^#{1,6}\s+[^\n]+\n+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return (
    <div className="base-prompt-trait-copy">
      <p className="m-0 text-label">{module.title}</p>
      <p className="m-0 text-body-sm text-secondary">
        {summary.slice(0, 120) || "No instructions yet."}
        {summary.length > 120 ? "…" : ""}
      </p>
    </div>
  );
}
