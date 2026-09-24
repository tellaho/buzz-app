import { useState, useSyncExternalStore } from "react";
import type { AgentInstructions } from "../../features/agent-instructions/service";
import type {
  AgentControl,
  AgentControlState,
} from "../../features/agents/control";
import { Button } from "../../shared/design-system/ui/Button";

/** Review/adoption only. Plugin activation never writes agent configuration. */
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
  const [error, setError] = useState<string | null>(null);
  const saved = state.data?.instructions;
  if (!saved || !control.adoptInstructions) return null;
  const text = proposal.composition.modules
    .map((module) => module.text)
    .join("");
  const savedText = saved.composition.modules
    .map((module) => module.text)
    .join("");
  const changed =
    JSON.stringify(proposal.composition) !== JSON.stringify(saved.composition);
  const pending =
    state.data?.agents.filter(
      (agent) =>
        agent.runningInstructions &&
        agent.runningInstructions.revision !== saved.revision,
    ).length ?? 0;
  return (
    <details className="rounded-xl border border-line p-4">
      <summary className="cursor-pointer text-label">
        Base instructions for all local agents
      </summary>
      <div className="mt-4 flex flex-col gap-3">
        <p className="m-0 text-body-sm text-secondary">
          Plugin switches change the proposal, not saved or running
          instructions. Apply explicitly, then restart running agents to use the
          saved revision. These defaults apply across communities in this app
          profile.
        </p>
        <p className="m-0 text-body-sm" role="status">
          Saved revision {saved.revision} · {pending} running{" "}
          {pending === 1 ? "agent needs" : "agents need"} restart.
          {changed
            ? " Plugin configuration differs from saved instructions."
            : " Proposal matches saved instructions."}
        </p>
        {proposal.error && <p role="alert">{proposal.error}</p>}
        {error && <p role="alert">{error}</p>}
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {proposal.composition.modules.map((module) => (
            <li key={module.key} className="text-body-sm">
              <strong>{module.title}</strong> · {module.pluginId} ·{" "}
              {module.revision}
            </li>
          ))}
        </ol>
        <details>
          <summary>
            Proposed base · approximately{" "}
            {Math.ceil(text.length / 4).toLocaleString()} tokens (estimate)
          </summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-body-sm">
            {text}
          </pre>
        </details>
        <details>
          <summary>Saved base · revision {saved.revision}</summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-body-sm">
            {savedText}
          </pre>
        </details>
        <div>
          <Button
            disabled={
              !changed ||
              !!proposal.error ||
              state.busy ||
              state.status !== "ready"
            }
            onClick={() => {
              setError(null);
              void control
                .adoptInstructions?.(saved.revision, proposal.composition)
                .catch(() =>
                  setError(
                    "Could not confirm adoption. Refresh status before retrying; no automatic restart was requested.",
                  ),
                );
            }}
          >
            Apply base instructions
          </Button>
        </div>
        <p className="m-0 text-body-sm text-secondary">
          This is a saved launch configuration, not a per-session delivery
          receipt. Module editing and per-agent overrides are not available yet.
        </p>
      </div>
    </details>
  );
}
