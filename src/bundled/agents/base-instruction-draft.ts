import type {
  InstructionCategory,
  InstructionDraft,
  InstructionProposal,
  InstructionTone,
  SavedInstructions,
  SavedModule,
} from "../../features/agent-instructions/service";
import {
  DEFAULT_INSTRUCTION_CATEGORIES,
  INSTRUCTION_TONES,
} from "../../features/agent-instructions/service";

export const LOCAL_INSTRUCTIONS_PLUGIN = "buzz.local-instructions";
export const LOCAL_INSTRUCTIONS_REVISION = "profile-v1";
export const DEFAULT_INSTRUCTIONS_PLUGIN = "buzz.agent-instructions";

export type InstructionModuleState = {
  origin: "default" | "plugin" | "custom";
  source: "current" | "unavailable" | "local";
  modified: boolean;
};

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
    categories: InstructionCategory[];
    modules: SavedModule[];
    plugins: { id: string; revision: string; enabled: boolean }[];
  };
  inactiveModules: SavedModule[];
};

export function instructionDraft(
  saved: SavedInstructions,
): MutableInstructionDraft {
  const structured = !!saved.composition.categories?.length;
  return {
    composition: {
      categories: (
        saved.composition.categories ?? DEFAULT_INSTRUCTION_CATEGORIES
      ).map((category) => ({ ...category })),
      modules: saved.composition.modules.map((module) => ({
        ...module,
        category: module.category ?? legacyCategoryId(module),
        text: structured ? module.text : legacyInstructionBody(module),
      })),
      plugins: saved.composition.plugins.map((plugin) => ({ ...plugin })),
    },
    inactiveModules: (saved.inactiveModules ?? []).map((module) => ({
      ...module,
      category: module.category ?? legacyCategoryId(module),
      text: structured ? module.text : legacyInstructionBody(module),
    })),
  };
}

export function normalizedModules(modules: readonly SavedModule[]) {
  return modules.map((module, index) => ({ ...module, order: index * 10 }));
}

export function instructionEditorText(text: string) {
  return text.trimEnd();
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

export function editableInstructionModule(module: SavedModule) {
  return (
    module.pluginId === LOCAL_INSTRUCTIONS_PLUGIN ||
    module.pluginId === DEFAULT_INSTRUCTIONS_PLUGIN
  );
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
  const enabled = new Map(
    proposal.composition.plugins
      .filter((plugin) => plugin.enabled)
      .map((plugin) => [plugin.id, plugin.revision]),
  );
  const retained = new Map(
    [...draft.composition.modules, ...draft.inactiveModules].map((module) => [
      module.key,
      module,
    ]),
  );
  const sourced = new Map(
    proposal.composition.modules.map((module) => [module.key, module]),
  );
  const active = draft.composition.modules.flatMap((module) => {
    if (module.pluginId === LOCAL_INSTRUCTIONS_PLUGIN) return [module];
    const source = sourced.get(module.key);
    if (!source || enabled.get(source.pluginId) !== source.revision) return [];
    const content =
      module.pluginId === DEFAULT_INSTRUCTIONS_PLUGIN
        ? { title: module.title, text: module.text }
        : {};
    return [
      {
        ...source,
        ...content,
        category: module.category ?? source.category ?? "plugins",
        order: module.order,
      },
    ];
  });
  for (const source of proposal.composition.modules) {
    if (
      enabled.get(source.pluginId) !== source.revision ||
      active.some((module) => module.key === source.key)
    )
      continue;
    const previous = retained.get(source.key);
    const preferredCategory =
      previous?.category ?? source.category ?? "plugins";
    active.push({
      ...source,
      category: draft.composition.categories.some(
        (category) => category.id === preferredCategory,
      )
        ? preferredCategory
        : "uncategorized",
      order: active.length * 10,
    });
  }
  const activeKeys = new Set(active.map((module) => module.key));
  const inactive = [
    ...draft.inactiveModules,
    ...draft.composition.modules.filter(
      (module) =>
        module.pluginId !== LOCAL_INSTRUCTIONS_PLUGIN &&
        !activeKeys.has(module.key),
    ),
  ].filter(
    (module, index, modules) =>
      !activeKeys.has(module.key) &&
      modules.findIndex((candidate) => candidate.key === module.key) === index,
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
    unavailable: [],
    draft: {
      composition: {
        categories: draft.composition.categories.map((category) => ({
          ...category,
        })),
        modules: normalizedModules(active),
        plugins: plugins.sort((a, b) => a.id.localeCompare(b.id)),
      },
      inactiveModules: inactive.map((module) => ({ ...module })),
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

const categories: Record<string, string> = {
  "buzz-identity": "core",
  "incoming-turn": "core",
  "buzz-cli": "core",
  projects: "plugins",
  "agent-creation": "capabilities",
  workspace: "capabilities",
  "agent-memory": "capabilities",
  mentions: "communication",
  "callback-mentions": "communication",
  threading: "communication",
  "general-communication": "communication",
  "engineering-discipline": "practice",
  "repository-workflow": "practice",
  autonomy: "practice",
};

function legacyCategoryId(module: SavedModule) {
  if (module.pluginId === LOCAL_INSTRUCTIONS_PLUGIN) return "custom";
  const known = categories[module.key.slice(module.key.lastIndexOf("/") + 1)];
  if (known) return known;
  return module.pluginId === DEFAULT_INSTRUCTIONS_PLUGIN ? "core" : "plugins";
}

export function instructionCategory(
  module: SavedModule,
  available:
    | readonly InstructionCategory[]
    | number = DEFAULT_INSTRUCTION_CATEGORIES,
): InstructionCategory {
  const categoryList = Array.isArray(available)
    ? available
    : DEFAULT_INSTRUCTION_CATEGORIES;
  const id = module.category ?? legacyCategoryId(module);
  const fallback =
    categoryList.find((category) => category.id === "uncategorized") ??
    DEFAULT_INSTRUCTION_CATEGORIES.find(
      (category) => category.id === "uncategorized",
    );
  if (!fallback) throw new Error("Missing Uncategorized instruction category");
  return categoryList.find((category) => category.id === id) ?? fallback;
}

export function estimateInstructionTokens(text: string) {
  return Math.ceil(text.length / 4);
}

export function instructionPercentage(characters: number, total: number) {
  return total > 0 ? (characters / total) * 100 : 0;
}

export function instructionCategorySummaries(
  modules: readonly SavedModule[],
  categories: readonly InstructionCategory[] = DEFAULT_INSTRUCTION_CATEGORIES,
): InstructionCategorySummary[] {
  const total = modules.reduce((sum, module) => sum + module.text.length, 0);
  const characters = new Map<string, number>();
  for (const module of modules) {
    const category = instructionCategory(module, categories);
    characters.set(
      category.id,
      (characters.get(category.id) ?? 0) + module.text.length,
    );
  }
  return categories.flatMap((category) => {
    const count = characters.get(category.id);
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

export function instructionPrompt(
  categories: readonly InstructionCategory[],
  modules: readonly SavedModule[],
) {
  const sections = categories.flatMap((category) => {
    const entries = modules.filter(
      (module) => (module.category ?? "uncategorized") === category.id,
    );
    if (!entries.length) return [];
    return [
      [
        `## ${category.title.trim()}`,
        ...entries.map((module) => {
          const body = module.text.trim();
          return `### ${module.title.trim()}${body ? `\n\n${body}` : ""}`;
        }),
      ].join("\n\n"),
    ];
  });
  return sections.length ? `${sections.join("\n\n")}\n` : "";
}

export function nextInstructionTone(
  categories: readonly InstructionCategory[],
): InstructionTone {
  const used = new Set(categories.map((category) => category.tone));
  return INSTRUCTION_TONES.find((tone) => !used.has(tone)) ?? "slate";
}

function legacyInstructionBody(module: SavedModule) {
  if (
    module.pluginId !== DEFAULT_INSTRUCTIONS_PLUGIN &&
    module.pluginId !== "buzz.projects"
  )
    return module.text;
  const lines = module.text.split(/\r?\n/);
  let index = 0;
  while (index < lines.length && !lines[index]?.trim()) index++;
  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";
    if (!/^#{1,3}(?:\s|$)/u.test(line)) break;
    index++;
    while (index < lines.length && !lines[index]?.trim()) index++;
  }
  return lines.slice(index).join("\n").trimEnd();
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
