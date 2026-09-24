import type {
  InstructionDraft,
  InstructionProposal,
  SavedInstructions,
  SavedModule,
} from "../../features/agent-instructions/service";

export const LOCAL_INSTRUCTIONS_PLUGIN = "buzz.local-instructions";
export const LOCAL_INSTRUCTIONS_REVISION = "profile-v1";

export type MutableInstructionDraft = {
  composition: {
    modules: SavedModule[];
    plugins: { id: string; revision: string; enabled: boolean }[];
  };
  inactiveModules: SavedModule[];
};

export function instructionDraft(
  saved: SavedInstructions,
): MutableInstructionDraft {
  return {
    composition: {
      modules: saved.composition.modules.map((module) => ({ ...module })),
      plugins: saved.composition.plugins.map((plugin) => ({ ...plugin })),
    },
    inactiveModules: (saved.inactiveModules ?? []).map((module) => ({
      ...module,
    })),
  };
}

export function normalizedModules(modules: readonly SavedModule[]) {
  return modules.map((module, index) => ({ ...module, order: index * 10 }));
}

export function availableInstructionModules(
  draft: MutableInstructionDraft,
  proposal: InstructionProposal,
): SavedModule[] {
  const selected = new Set(
    draft.composition.modules.map((module) => module.key),
  );
  const inactive = draft.inactiveModules.filter(
    (module) => !selected.has(module.key),
  );
  const known = new Set(inactive.map((module) => module.key));
  return [
    ...inactive,
    ...proposal.composition.modules.filter(
      (module) => !selected.has(module.key) && !known.has(module.key),
    ),
  ];
}

export function sourceModule(
  key: string,
  proposal: InstructionProposal,
): SavedModule | undefined {
  return proposal.composition.modules.find((module) => module.key === key);
}

export function preparedInstructionDraft(
  draft: MutableInstructionDraft,
  proposal: InstructionProposal,
): { draft: InstructionDraft; unavailable: SavedModule[] } {
  const unavailable = draft.composition.modules.filter(
    (module) =>
      module.pluginId !== LOCAL_INSTRUCTIONS_PLUGIN &&
      !proposal.composition.plugins.some(
        (plugin) =>
          plugin.id === module.pluginId &&
          plugin.revision === module.revision &&
          plugin.enabled,
      ),
  );
  const plugins = proposal.composition.plugins.map((plugin) => ({ ...plugin }));
  if (
    draft.composition.modules.some(
      (module) => module.pluginId === LOCAL_INSTRUCTIONS_PLUGIN,
    ) &&
    !plugins.some((plugin) => plugin.id === LOCAL_INSTRUCTIONS_PLUGIN)
  ) {
    plugins.push({
      id: LOCAL_INSTRUCTIONS_PLUGIN,
      revision: LOCAL_INSTRUCTIONS_REVISION,
      enabled: true,
    });
  }
  return {
    unavailable,
    draft: {
      composition: {
        modules: normalizedModules(draft.composition.modules),
        plugins: plugins.sort((a, b) => a.id.localeCompare(b.id)),
      },
      inactiveModules: draft.inactiveModules.map((module) => ({ ...module })),
    },
  };
}

export function instructionDraftChanged(
  draft: MutableInstructionDraft,
  saved: SavedInstructions,
  proposal: InstructionProposal,
) {
  return (
    JSON.stringify(preparedInstructionDraft(draft, proposal).draft) !==
    JSON.stringify({
      composition: saved.composition,
      inactiveModules: saved.inactiveModules ?? [],
    })
  );
}

const groups: Record<string, string> = {
  "buzz-identity": "Core",
  "incoming-turn": "Core",
  "buzz-cli": "Core",
  projects: "Capabilities",
  "agent-creation": "Capabilities",
  workspace: "Capabilities",
  "agent-memory": "Capabilities",
  mentions: "Communication",
  "callback-mentions": "Communication",
  threading: "Communication",
  "general-communication": "Communication",
  "engineering-discipline": "Practice",
  "repository-workflow": "Practice",
  autonomy: "Practice",
};

export function instructionGroup(module: SavedModule) {
  if (module.pluginId === LOCAL_INSTRUCTIONS_PLUGIN) return "Custom";
  return groups[module.key.slice(module.key.lastIndexOf("/") + 1)] ?? "Other";
}
