import type {
  InstructionDraft,
  InstructionProposal,
  SavedInstructions,
  SavedModule,
} from "../../features/agent-instructions/service";

export const LOCAL_INSTRUCTIONS_PLUGIN = "buzz.local-instructions";
export const LOCAL_INSTRUCTIONS_REVISION = "profile-v1";
export const DEFAULT_INSTRUCTIONS_PLUGIN = "buzz.agent-instructions";

export type InstructionModuleState = {
  origin: "default" | "plugin" | "custom";
  source: "current" | "unavailable" | "local";
  modified: boolean;
};

export const INSTRUCTION_CATEGORIES = [
  "Core",
  "Capabilities",
  "Communication",
  "Practice",
  "Custom",
  "Plugin",
] as const;
export type InstructionCategory = (typeof INSTRUCTION_CATEGORIES)[number];

export type InstructionCategorySummary = {
  category: InstructionCategory;
  characters: number;
  tokens: number;
  percentage: number;
};

export type InstructionTileSpan = {
  units: number;
  columns: number;
  rows: number;
};

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

export function instructionEditorText(text: string) {
  return text.trimEnd();
}

export function instructionTextWithBoundary(text: string, source: string) {
  return `${text.trimEnd()}${source.slice(source.trimEnd().length)}`;
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

export function instructionModuleState(
  module: SavedModule,
  proposal: InstructionProposal,
): InstructionModuleState {
  if (module.pluginId === LOCAL_INSTRUCTIONS_PLUGIN)
    return { origin: "custom", source: "local", modified: false };

  const origin =
    module.pluginId === DEFAULT_INSTRUCTIONS_PLUGIN ? "default" : "plugin";
  const source = sourceModule(module.key, proposal);
  if (
    !source ||
    source.pluginId !== module.pluginId ||
    source.revision !== module.revision
  )
    return { origin, source: "unavailable", modified: false };

  return {
    origin,
    source: "current",
    modified: module.title !== source.title || module.text !== source.text,
  };
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

const categories: Record<string, InstructionCategory> = {
  "buzz-identity": "Core",
  "incoming-turn": "Core",
  "buzz-cli": "Core",
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

export function instructionCategory(module: SavedModule): InstructionCategory {
  if (module.pluginId === LOCAL_INSTRUCTIONS_PLUGIN) return "Custom";
  if (module.pluginId !== DEFAULT_INSTRUCTIONS_PLUGIN) return "Plugin";
  const known = categories[module.key.slice(module.key.lastIndexOf("/") + 1)];
  if (known) return known;
  return "Core";
}

export function estimateInstructionTokens(text: string) {
  return Math.ceil(text.length / 4);
}

export function instructionPercentage(characters: number, total: number) {
  return total > 0 ? (characters / total) * 100 : 0;
}

export function instructionCategorySummaries(
  modules: readonly SavedModule[],
): InstructionCategorySummary[] {
  const total = modules.reduce((sum, module) => sum + module.text.length, 0);
  const characters = new Map<InstructionCategory, number>();
  for (const module of modules) {
    const category = instructionCategory(module);
    characters.set(
      category,
      (characters.get(category) ?? 0) + module.text.length,
    );
  }
  return INSTRUCTION_CATEGORIES.flatMap((category) => {
    const count = characters.get(category);
    return count === undefined
      ? []
      : [
          {
            category,
            characters: count,
            tokens: Math.ceil(count / 4),
            percentage: instructionPercentage(count, total),
          },
        ];
  });
}

export function instructionBoardColumns(width: number) {
  if (width >= 640) return 6;
  if (width >= 440) return 4;
  return 3;
}

export function instructionTileSpan(
  characters: number,
  total: number,
  boardColumns: number,
): InstructionTileSpan {
  const targetCells = boardColumns * 5;
  const units = Math.max(
    1,
    Math.round(instructionPercentage(characters, total) * targetCells * 0.01),
  );
  const columns = Math.min(boardColumns, Math.ceil(Math.sqrt(units)));
  return { units, columns, rows: Math.ceil(units / columns) };
}
