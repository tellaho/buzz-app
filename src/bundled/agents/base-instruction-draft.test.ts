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
  instructionTileSpan,
  instructionTextWithBoundary,
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

    expect(modules.map(instructionCategory)).toEqual([
      "Core",
      "Capabilities",
      "Plugin",
      "Plugin",
      "Custom",
    ]);
    expect(estimateInstructionTokens("12345")).toBe(2);
    expect(instructionCategorySummaries(modules)).toEqual([
      {
        category: "Core",
        characters: 8,
        tokens: 2,
        percentage: (8 / 60) * 100,
      },
      {
        category: "Capabilities",
        characters: 16,
        tokens: 4,
        percentage: (16 / 60) * 100,
      },
      {
        category: "Custom",
        characters: 4,
        tokens: 1,
        percentage: (4 / 60) * 100,
      },
      {
        category: "Plugin",
        characters: 32,
        tokens: 8,
        percentage: (32 / 60) * 100,
      },
    ]);
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

  it("hides trailing whitespace while preserving the source boundary", () => {
    expect(instructionEditorText("Instructions.\n\n  \n")).toBe(
      "Instructions.",
    );
    expect(instructionEditorText("  \n")).toBe("");
    expect(instructionTextWithBoundary("Edited.\n\n\n", "Original.\n\n")).toBe(
      "Edited.\n\n",
    );
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
    ).toEqual([0, 10]);
    expect(prepared.draft.composition.plugins).toContainEqual({
      id: LOCAL_INSTRUCTIONS_PLUGIN,
      revision: LOCAL_INSTRUCTIONS_REVISION,
      enabled: true,
    });
    expect(instructionDraftChanged(draft, saved, proposal)).toBe(true);
  });

  it("blocks active traits whose contributing revision is unavailable", () => {
    const saved: SavedInstructions = {
      revision: 1,
      composition: {
        modules: [{ ...module("fixture/core", "active"), revision: "old" }],
        plugins: [{ id: "fixture", revision: "old", enabled: true }],
      },
      inactiveModules: [],
    };
    expect(
      preparedInstructionDraft(instructionDraft(saved), proposal).unavailable,
    ).toEqual([expect.objectContaining({ key: "fixture/core" })]);
  });
});
