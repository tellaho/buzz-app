import { describe, expect, it } from "vitest";
import type {
  InstructionProposal,
  SavedInstructions,
  SavedModule,
} from "../../features/agent-instructions/service";
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
  instructionPrompt,
  instructionTileSpan,
  LOCAL_INSTRUCTIONS_PLUGIN,
  LOCAL_INSTRUCTIONS_REVISION,
  normalizedModules,
  preparedInstructionDraft,
} from "./base-instruction-draft";

const module = (
  key: string,
  text: string,
  pluginId = "fixture",
): SavedModule => ({
  key,
  title: key,
  pluginId,
  revision:
    pluginId === LOCAL_INSTRUCTIONS_PLUGIN ? LOCAL_INSTRUCTIONS_REVISION : "v1",
  order: 0,
  text,
});
const proposal: InstructionProposal = {
  composition: {
    modules: [
      module("fixture/core", "default"),
      module("fixture/extra", "extra"),
    ],
    plugins: [{ id: "fixture", revision: "v1", enabled: true }],
  },
  error: null,
};

describe("base instruction drafts", () => {
  it("assigns plugin contributions automatically and groups prompt cost by category", () => {
    const modules = [
      module(
        `${DEFAULT_INSTRUCTIONS_PLUGIN}/buzz-identity`,
        "a".repeat(8),
        DEFAULT_INSTRUCTIONS_PLUGIN,
      ),
      module(
        `${DEFAULT_INSTRUCTIONS_PLUGIN}/agent-creation`,
        "e".repeat(16),
        DEFAULT_INSTRUCTIONS_PLUGIN,
      ),
      module("buzz.projects/projects", "b".repeat(12), "buzz.projects"),
      module("fixture/extension", "c".repeat(20)),
      module(
        `${LOCAL_INSTRUCTIONS_PLUGIN}/custom`,
        "d".repeat(4),
        LOCAL_INSTRUCTIONS_PLUGIN,
      ),
    ];

    expect(
      modules.map(instructionCategory).map((category) => category.id),
    ).toEqual(["core", "capabilities", "plugins", "plugins", "custom"]);
    expect(estimateInstructionTokens("12345")).toBe(2);
    expect(instructionCategorySummaries(modules)).toEqual([
      {
        category: expect.objectContaining({ id: "core" }),
        characters: 8,
        tokens: 2,
        percentage: (8 / 60) * 100,
      },
      {
        category: expect.objectContaining({ id: "capabilities" }),
        characters: 16,
        tokens: 4,
        percentage: (16 / 60) * 100,
      },
      {
        category: expect.objectContaining({ id: "custom" }),
        characters: 4,
        tokens: 1,
        percentage: (4 / 60) * 100,
      },
      {
        category: expect.objectContaining({ id: "plugins" }),
        characters: 32,
        tokens: 8,
        percentage: (32 / 60) * 100,
      },
    ]);
    const identity = modules[0];
    const mine = modules[4];
    if (!identity || !mine) throw new Error("Expected instruction fixtures");
    expect(
      instructionPrompt(
        [
          { id: "core", title: "Core", tone: "purple" },
          { id: "custom", title: "Custom", tone: "amber" },
        ],
        [
          { ...identity, title: "Identity", category: "core" },
          { ...mine, title: "Mine", category: "custom" },
        ],
      ),
    ).toBe(
      `## Core\n\n### Identity\n\n${"a".repeat(8)}\n\n## Custom\n\n### Mine\n\n${"d".repeat(4)}\n`,
    );
  });

  it("quantizes relative prompt share into compact responsive tile spans", () => {
    expect(instructionBoardColumns(639)).toBe(4);
    expect(instructionBoardColumns(440)).toBe(4);
    expect(instructionBoardColumns(439)).toBe(3);
    expect(instructionBoardColumns(640)).toBe(6);
    expect(instructionTileSpan(0, 0, 6)).toEqual({
      units: 1,
      columns: 1,
      rows: 1,
    });
    expect(instructionTileSpan(53, 4428, 6)).toEqual({
      units: 1,
      columns: 1,
      rows: 1,
    });
    expect(instructionTileSpan(607, 4428, 6)).toEqual({
      units: 4,
      columns: 2,
      rows: 2,
    });
  });

  it("classifies module origin and source state without treating order as an edit", () => {
    const defaultSource = module(
      `${DEFAULT_INSTRUCTIONS_PLUGIN}/core`,
      "default",
      DEFAULT_INSTRUCTIONS_PLUGIN,
    );
    const pluginSource = module("fixture/plugin", "plugin");
    const stateProposal: InstructionProposal = {
      composition: {
        modules: [defaultSource, pluginSource],
        plugins: [
          { id: DEFAULT_INSTRUCTIONS_PLUGIN, revision: "v1", enabled: true },
          { id: "fixture", revision: "v1", enabled: true },
        ],
      },
      error: null,
    };

    expect(
      instructionModuleState({ ...defaultSource, order: 80 }, stateProposal),
    ).toEqual({ origin: "default", source: "current", modified: false });
    expect(
      instructionModuleState(
        { ...defaultSource, title: "Personal default" },
        stateProposal,
      ),
    ).toEqual({ origin: "default", source: "current", modified: true });
    expect(instructionModuleState(pluginSource, stateProposal)).toEqual({
      origin: "plugin",
      source: "current",
      modified: false,
    });
    expect(
      instructionModuleState(
        { ...pluginSource, text: "personalized" },
        stateProposal,
      ),
    ).toEqual({ origin: "plugin", source: "current", modified: true });
    expect(
      instructionModuleState(
        module(
          `${LOCAL_INSTRUCTIONS_PLUGIN}/custom`,
          "custom",
          LOCAL_INSTRUCTIONS_PLUGIN,
        ),
        stateProposal,
      ),
    ).toEqual({ origin: "custom", source: "local", modified: false });
    expect(
      instructionModuleState(
        { ...pluginSource, revision: "old" },
        stateProposal,
      ),
    ).toEqual({ origin: "plugin", source: "unavailable", modified: false });
  });

  it("hides trailing whitespace in editors", () => {
    expect(instructionEditorText("Instructions.\n\n  \n")).toBe(
      "Instructions.",
    );
    expect(instructionEditorText("  \n")).toBe("");
  });

  it("prefers retained inactive edits over source defaults", () => {
    const saved: SavedInstructions = {
      revision: 1,
      composition: {
        modules: [module("fixture/core", "active")],
        plugins: proposal.composition.plugins,
      },
      inactiveModules: [module("fixture/extra", "personalized")],
    };
    const available = availableInstructionModules(
      instructionDraft(saved),
      proposal,
    );
    expect(available).toEqual([
      expect.objectContaining({ key: "fixture/extra", text: "personalized" }),
    ]);
  });

  it("normalizes order and adds a synthetic source only for active custom traits", () => {
    const custom = module(
      `${LOCAL_INSTRUCTIONS_PLUGIN}/custom`,
      "local",
      LOCAL_INSTRUCTIONS_PLUGIN,
    );
    const saved: SavedInstructions = {
      revision: 1,
      composition: {
        modules: normalizedModules([custom, module("fixture/core", "active")]),
        plugins: proposal.composition.plugins,
      },
      inactiveModules: [],
    };
    const draft = instructionDraft(saved);
    const prepared = preparedInstructionDraft(draft, proposal);
    expect(prepared.unavailable).toEqual([]);
    expect(
      prepared.draft.composition.modules.map((entry) => entry.order),
    ).toEqual([0, 10, 20]);
    expect(prepared.draft.composition.plugins).toContainEqual({
      id: LOCAL_INSTRUCTIONS_PLUGIN,
      revision: LOCAL_INSTRUCTIONS_REVISION,
      enabled: true,
    });
    expect(instructionDraftChanged(draft, saved, proposal)).toBe(true);
  });

  it("replaces stale plugin entries from the enabled proposal", () => {
    const saved: SavedInstructions = {
      revision: 1,
      composition: {
        modules: [{ ...module("fixture/core", "active"), revision: "old" }],
        plugins: [{ id: "fixture", revision: "old", enabled: true }],
      },
      inactiveModules: [],
    };
    const prepared = preparedInstructionDraft(
      instructionDraft(saved),
      proposal,
    );
    expect(prepared.unavailable).toEqual([]);
    expect(prepared.draft.composition.modules).toContainEqual(
      expect.objectContaining({ key: "fixture/core", revision: "v1" }),
    );
  });

  it("preserves edits to bundled default entries when applying", () => {
    const source = {
      ...module(
        `${DEFAULT_INSTRUCTIONS_PLUGIN}/default`,
        "Bundled body.",
        DEFAULT_INSTRUCTIONS_PLUGIN,
      ),
      category: "core",
    };
    const customized = {
      ...source,
      title: "Personalized default",
      text: "Personalized body.",
    };
    const defaultProposal: InstructionProposal = {
      composition: {
        modules: [source],
        plugins: [
          {
            id: DEFAULT_INSTRUCTIONS_PLUGIN,
            revision: "v1",
            enabled: true,
          },
        ],
      },
      error: null,
    };
    const saved: SavedInstructions = {
      revision: 1,
      composition: {
        modules: [customized],
        plugins: defaultProposal.composition.plugins,
      },
      inactiveModules: [],
    };

    expect(
      preparedInstructionDraft(instructionDraft(saved), defaultProposal).draft
        .composition.modules,
    ).toContainEqual(
      expect.objectContaining({
        key: source.key,
        title: "Personalized default",
        text: "Personalized body.",
      }),
    );
  });

  it("rehomes a newly contributed entry when its default category was deleted", () => {
    const draft = instructionDraft({
      revision: 1,
      composition: {
        categories: [
          { id: "plugins", title: "Plugins", tone: "cyan" },
          { id: "uncategorized", title: "Uncategorized", tone: "slate" },
        ],
        modules: [module("fixture/core", "default")],
        plugins: proposal.composition.plugins,
      },
      inactiveModules: [],
    });
    const incoming: InstructionProposal = {
      ...proposal,
      composition: {
        ...proposal.composition,
        modules: [
          ...proposal.composition.modules,
          { ...module("fixture/new", "new"), category: "core" },
        ],
      },
    };

    expect(
      preparedInstructionDraft(draft, incoming).draft.composition.modules,
    ).toContainEqual(
      expect.objectContaining({
        key: "fixture/new",
        category: "uncategorized",
      }),
    );
  });

  it("deactivates plugin entries only when their plugin is disabled", () => {
    const active = module("fixture/core", "saved");
    const retained = {
      ...module("other/core", "retained", "other"),
      revision: "v1",
    };
    const saved: SavedInstructions = {
      revision: 1,
      composition: {
        modules: normalizedModules([active, retained]),
        plugins: [
          { id: "fixture", revision: "v1", enabled: true },
          { id: "other", revision: "v1", enabled: true },
        ],
      },
      inactiveModules: [],
    };
    const disabled: InstructionProposal = {
      composition: {
        modules: [retained],
        plugins: [
          { id: "fixture", revision: "v1", enabled: false },
          { id: "other", revision: "v1", enabled: true },
        ],
      },
      error: null,
    };

    const prepared = preparedInstructionDraft(
      instructionDraft(saved),
      disabled,
    ).draft;
    expect(prepared.composition.modules).toEqual([
      expect.objectContaining({ key: retained.key }),
    ]);
    expect(prepared.inactiveModules).toContainEqual(
      expect.objectContaining({ key: active.key }),
    );
    expect(prepared.composition.plugins).toEqual(disabled.composition.plugins);
  });
});
