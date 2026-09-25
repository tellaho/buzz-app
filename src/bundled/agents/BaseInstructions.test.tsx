// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { BaseInstructions } from "./BaseInstructions";
import type {
  AgentInstructions,
  InstructionProposal,
} from "../../features/agent-instructions/service";
import { createAgentControl } from "../../features/agents/control";
import { useSyncExternalStore } from "react";
import { controlFixture } from "../../features/agents/control-testing";
import {
  DEFAULT_INSTRUCTIONS_PLUGIN,
  LOCAL_INSTRUCTIONS_PLUGIN,
  LOCAL_INSTRUCTIONS_REVISION,
} from "./base-instruction-draft";

afterEach(cleanup);
const proposal: InstructionProposal = {
  composition: {
    modules: [
      {
        key: "fixture/core",
        title: "Core",
        pluginId: "fixture",
        revision: "v1",
        order: 0,
        text: "proposed instructions",
      },
    ],
    plugins: [{ id: "fixture", revision: "v1", enabled: true }],
  },
  error: null,
};
const instructions: AgentInstructions = {
  register() {},
  snapshot: () => proposal,
  subscribe: () => () => {},
};
function editCore(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "Core" }));
  fireEvent.change(screen.getByLabelText("Instructions"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save trait" }));
}
it("requires explicit adoption, retains saved state on failure and never restarts", async () => {
  const fixture = controlFixture();
  const saved = {
    revision: 1,
    composition: {
      ...proposal.composition,
      modules: proposal.composition.modules.map((module) => ({
        ...module,
        text: "saved instructions\n\n",
      })),
    },
    inactiveModules: [],
  };
  const host = {
    ...fixture.host,
    snapshot: async () => ({
      agents: [],
      runtimeAvailable: true,
      instructions: saved,
    }),
    adoptInstructions: vi.fn().mockRejectedValue("fixture write failure"),
    action: vi.fn(),
  };
  const control = createAgentControl(host);
  await control.refresh();
  function Harness() {
    const state = useSyncExternalStore(control.subscribe, control.snapshot);
    return (
      <BaseInstructions
        instructions={instructions}
        control={control}
        state={state}
      />
    );
  }
  render(<Harness />);
  expect(host.adoptInstructions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Core" }));
  expect(
    (screen.getByLabelText("Instructions") as HTMLTextAreaElement).value,
  ).toBe("saved instructions");
  fireEvent.change(screen.getByLabelText("Instructions"), {
    target: { value: "edited instructions\n\n" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save trait" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply base prompt" }));
  await waitFor(() =>
    expect(screen.getByText(/Could not confirm the base prompt/)).toBeTruthy(),
  );
  expect(host.adoptInstructions).toHaveBeenCalledWith(1, {
    composition: {
      ...proposal.composition,
      modules: [
        expect.objectContaining({
          key: "fixture/core",
          text: "edited instructions\n\n",
        }),
      ],
    },
    inactiveModules: [],
  });
  expect(control.snapshot().data?.instructions).toEqual(saved);
  expect(host.action).not.toHaveBeenCalled();
  control.dispose();
});

it("shows adoption only after native confirmation and leaves restart explicit", async () => {
  const fixture = controlFixture();
  const saved = {
    revision: 1,
    composition: {
      ...proposal.composition,
      modules: proposal.composition.modules.map((module) => ({
        ...module,
        text: "saved base",
      })),
    },
    inactiveModules: [],
  };
  const before = { agents: [], runtimeAvailable: true, instructions: saved };
  const applied = {
    composition: {
      ...proposal.composition,
      modules: proposal.composition.modules.map((module) => ({
        ...module,
        text: "edited base",
      })),
    },
    inactiveModules: [],
  };
  const after = {
    ...before,
    instructions: { revision: 2, ...applied },
  };
  let confirm!: (value: typeof after) => void;
  const host = {
    ...fixture.host,
    snapshot: async () => before,
    adoptInstructions: vi.fn(
      () =>
        new Promise<typeof after>((resolve) => {
          confirm = resolve;
        }),
    ),
    action: vi.fn(),
  };
  const control = createAgentControl(host);
  await control.refresh();
  function Harness() {
    const state = useSyncExternalStore(control.subscribe, control.snapshot);
    return (
      <BaseInstructions
        instructions={instructions}
        control={control}
        state={state}
      />
    );
  }
  render(<Harness />);
  editCore("edited base");
  fireEvent.click(screen.getByRole("button", { name: "Apply base prompt" }));
  try {
    await waitFor(() => expect(host.adoptInstructions).toHaveBeenCalledOnce());
    expect(control.snapshot().data?.instructions?.revision).toBe(1);
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Apply base prompt" })
          .getAttribute("aria-busy"),
      ).toBe("true"),
    );
  } finally {
    confirm(after);
  }
  await waitFor(() =>
    expect(control.snapshot().data?.instructions?.revision).toBe(2),
  );
  expect(
    screen.getByRole("button", { name: "Apply base prompt" }),
  ).toBeDisabled();
  expect(host.adoptInstructions).toHaveBeenCalledWith(1, applied);
  expect(host.action).not.toHaveBeenCalled();
  control.dispose();
});

it("presents compact base prompt metrics without exposing the saved revision", async () => {
  const fixture = controlFixture();
  const first = proposal.composition.modules[0];
  if (!first) throw new Error("Expected fixture proposal");
  const modules = Array.from({ length: 13 }, (_, index) => ({
    ...first,
    key: `fixture/metric-${index}`,
    title: `Metric ${index + 1}`,
    order: index * 10,
    text: index === 0 ? "x".repeat(16_796) : "",
  }));
  const sourceProposal = {
    composition: { ...proposal.composition, modules },
    error: null,
  };
  const source: AgentInstructions = {
    register() {},
    snapshot: () => sourceProposal,
    subscribe: () => () => {},
  };
  const saved = {
    revision: 7,
    composition: { ...proposal.composition, modules },
    inactiveModules: [],
  };
  const outdated = {
    ...structuredClone(fixture.agent),
    id: "outdated",
    runningInstructions: { revision: 6, sha256: "a".repeat(64) },
  };
  const current = {
    ...structuredClone(fixture.agent),
    id: "current",
    runningInstructions: { revision: 7, sha256: "b".repeat(64) },
  };
  const notRunning = {
    ...structuredClone(fixture.agent),
    id: "not-running",
    runningInstructions: null,
  };
  const control = createAgentControl({
    ...fixture.host,
    snapshot: async () => ({
      agents: [outdated, current, notRunning],
      runtimeAvailable: true,
      instructions: saved,
    }),
    adoptInstructions: async () => ({
      agents: [outdated, current, notRunning],
      runtimeAvailable: true,
      instructions: saved,
    }),
  });
  await control.refresh();
  function Harness() {
    const state = useSyncExternalStore(control.subscribe, control.snapshot);
    return (
      <BaseInstructions instructions={source} control={control} state={state} />
    );
  }
  render(<Harness />);

  const summary = screen.getByRole("region", { name: "Base prompt summary" });
  expect(within(summary).getByText("Active traits")).toBeVisible();
  expect(within(summary).getByText("13")).toBeVisible();
  expect(within(summary).getByText("Estimated tokens")).toBeVisible();
  expect(within(summary).getByText("~4.2K")).toBeVisible();
  expect(within(summary).getByText("Approximately 4,199 tokens")).toHaveClass(
    "sr-only",
  );
  expect(within(summary).getByText("Running agents to restart")).toBeVisible();
  expect(within(summary).getByText("1")).toBeVisible();
  expect(summary).not.toHaveTextContent(/Saved revision/i);
  control.dispose();
});

it("stages accessible reordering, retained removal and custom trait creation", async () => {
  const user = userEvent.setup();
  const firstProposal = proposal.composition.modules[0];
  if (!firstProposal) throw new Error("Expected fixture proposal");
  const secondProposal: InstructionProposal = {
    composition: {
      modules: [
        firstProposal,
        {
          ...firstProposal,
          key: "fixture/second",
          title: "Second",
          order: 10,
          text: "second instructions",
        },
      ],
      plugins: proposal.composition.plugins,
    },
    error: null,
  };
  const source: AgentInstructions = {
    register() {},
    snapshot: () => secondProposal,
    subscribe: () => () => {},
  };
  const saved = {
    revision: 1,
    composition: secondProposal.composition,
    inactiveModules: [],
  };
  const fixture = controlFixture();
  const control = createAgentControl({
    ...fixture.host,
    snapshot: async () => ({
      agents: [],
      runtimeAvailable: true,
      instructions: saved,
    }),
    adoptInstructions: async () => ({
      agents: [],
      runtimeAvailable: true,
      instructions: saved,
    }),
  });
  await control.refresh();
  function Harness() {
    const state = useSyncExternalStore(control.subscribe, control.snapshot);
    return (
      <BaseInstructions instructions={source} control={control} state={state} />
    );
  }
  const view = render(<Harness />);
  const board = screen.getByRole("list", {
    name: "Prompt traits in sequence",
  });

  expect(screen.queryByText("proposed instructions")).toBeNull();
  expect(screen.queryByRole("region", { name: "Available traits" })).toBeNull();
  expect(board.querySelectorAll("[data-trait-units]")).toHaveLength(2);
  expect(
    [...board.querySelectorAll<HTMLElement>("[data-trait-units]")].every(
      (tile) => Number(tile.dataset.traitUnits) >= 1,
    ),
  ).toBe(true);
  expect(
    screen.getByRole("list", { name: "Approximate prompt cost by category" }),
  ).toHaveTextContent(/Plugin\s*~10\s*·\s*100%/);
  await user.click(screen.getByRole("button", { name: "Core" }));
  expect(screen.getByRole("dialog", { name: "Edit Core" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  await user.click(screen.getByRole("button", { name: "Actions for Core" }));
  await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
  expect(screen.getByRole("dialog", { name: "Edit Core" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  const coreRow = screen
    .getByRole("button", { name: "Core" })
    .closest<HTMLElement>("[data-trait-key]");
  const secondRow = screen
    .getByRole("button", { name: "Second" })
    .closest<HTMLElement>("[data-trait-key]");
  if (!coreRow || !secondRow) throw new Error("Expected prompt tiles");
  const originalElementsFromPoint = document.elementsFromPoint;
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [coreRow],
  });
  try {
    fireEvent.pointerDown(secondRow, {
      button: 0,
      clientX: 10,
      clientY: 10,
      isPrimary: true,
      pointerId: 7,
    });
    fireEvent.pointerMove(secondRow, {
      clientX: 30,
      clientY: 30,
      isPrimary: true,
      pointerId: 7,
    });
    expect(secondRow).toHaveAttribute("data-dragging", "true");
    fireEvent.pointerUp(secondRow, { pointerId: 7 });
  } finally {
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: originalElementsFromPoint,
    });
  }
  expect(
    [...view.container.querySelectorAll("[data-trait-key]")].map((row) =>
      row.getAttribute("data-trait-key"),
    ),
  ).toEqual(["fixture/second", "fixture/core"]);

  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [secondRow],
  });
  fireEvent.pointerDown(coreRow, {
    button: 0,
    clientX: 10,
    clientY: 10,
    isPrimary: true,
    pointerId: 8,
  });
  fireEvent.pointerMove(coreRow, {
    clientX: 30,
    clientY: 30,
    isPrimary: true,
    pointerId: 8,
  });
  fireEvent.keyDown(window, { key: "Escape" });
  expect(coreRow).not.toHaveAttribute("data-dragging");
  fireEvent.pointerUp(coreRow, { pointerId: 8 });
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: originalElementsFromPoint,
  });
  expect(
    [...view.container.querySelectorAll("[data-trait-key]")].map((row) =>
      row.getAttribute("data-trait-key"),
    ),
  ).toEqual(["fixture/second", "fixture/core"]);

  await user.click(screen.getByRole("button", { name: "Actions for Core" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Move earlier" }),
  );
  await user.click(screen.getByRole("button", { name: "Actions for Second" }));
  await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
  await user.click(screen.getByRole("button", { name: "Add trait" }));
  const availableMenu = await screen.findByRole("dialog", {
    name: "Available traits",
  });
  expect(
    within(availableMenu).getByRole("button", { name: "Add" }),
  ).toBeTruthy();
  expect(availableMenu).toHaveTextContent("Plugin · ~5 tokens");

  fireEvent.click(
    within(availableMenu).getByRole("button", { name: "New trait" }),
  );
  fireEvent.change(screen.getByLabelText("Trait name"), {
    target: { value: "Curiosity" },
  });
  fireEvent.change(screen.getByLabelText("Instructions"), {
    target: { value: "Ask one useful question." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save trait" }));
  expect(screen.getByRole("button", { name: "Curiosity" })).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Curiosity" })
      .closest("[data-trait-category]"),
  ).toHaveAttribute("data-trait-category", "custom");
  expect(
    screen.getByRole("list", { name: "Approximate prompt cost by category" }),
  ).toHaveTextContent("Custom");
  await user.click(
    screen.getByRole("button", { name: "Actions for Curiosity" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
  await user.click(screen.getByRole("button", { name: "Add trait" }));
  expect(
    within(
      await screen.findByRole("dialog", { name: "Available traits" }),
    ).getByRole("button", { name: "Delete Curiosity" }),
  ).toBeTruthy();
  control.dispose();
});

it("shows compact origin and modification states in both trait lists", async () => {
  const user = userEvent.setup();
  const defaultModule = {
    key: `${DEFAULT_INSTRUCTIONS_PLUGIN}/core`,
    title: "Default behavior",
    pluginId: DEFAULT_INSTRUCTIONS_PLUGIN,
    revision: "bundled",
    order: 0,
    text: "Default instructions",
  };
  const pluginModule = {
    key: "fixture/plugin",
    title: "Plugin behavior",
    pluginId: "fixture",
    revision: "v1",
    order: 10,
    text: "Plugin instructions",
  };
  const unavailableSource = {
    ...pluginModule,
    key: "fixture/unavailable",
    title: "Unavailable behavior",
    order: 20,
  };
  const source: InstructionProposal = {
    composition: {
      modules: [defaultModule, pluginModule, unavailableSource],
      plugins: [
        {
          id: DEFAULT_INSTRUCTIONS_PLUGIN,
          revision: "bundled",
          enabled: true,
        },
        { id: "fixture", revision: "v1", enabled: true },
      ],
    },
    error: null,
  };
  const customModule = {
    key: `${LOCAL_INSTRUCTIONS_PLUGIN}/custom`,
    title: "Custom behavior",
    pluginId: LOCAL_INSTRUCTIONS_PLUGIN,
    revision: LOCAL_INSTRUCTIONS_REVISION,
    order: 20,
    text: "Custom instructions",
  };
  const saved = {
    revision: 1,
    composition: {
      ...source.composition,
      modules: [
        defaultModule,
        { ...pluginModule, text: "Personalized plugin instructions" },
      ],
    },
    inactiveModules: [customModule, { ...unavailableSource, revision: "old" }],
  };
  const fixture = controlFixture();
  const control = createAgentControl({
    ...fixture.host,
    snapshot: async () => ({
      agents: [],
      runtimeAvailable: true,
      instructions: saved,
    }),
    adoptInstructions: async () => ({
      agents: [],
      runtimeAvailable: true,
      instructions: saved,
    }),
  });
  await control.refresh();
  const instructionSource: AgentInstructions = {
    register() {},
    snapshot: () => source,
    subscribe: () => () => {},
  };
  function Harness() {
    const state = useSyncExternalStore(control.subscribe, control.snapshot);
    return (
      <BaseInstructions
        instructions={instructionSource}
        control={control}
        state={state}
      />
    );
  }
  render(<Harness />);

  const defaultRow = screen
    .getByRole("button", { name: "Default behavior" })
    .closest("li");
  const modifiedPluginRow = screen
    .getByRole("button", { name: "Plugin behavior" })
    .closest("li");
  await user.click(screen.getByRole("button", { name: "Add trait" }));
  let availableMenu = await screen.findByRole("dialog", {
    name: "Available traits",
  });
  const customRow = within(availableMenu)
    .getByRole("button", { name: "Custom behavior" })
    .closest("li");
  expect(defaultRow).toHaveAttribute("data-trait-origin", "default");
  expect(defaultRow).not.toHaveAttribute("data-trait-modified");
  expect(
    within(defaultRow as HTMLElement).getByRole("img", {
      name: "Core category",
    }),
  ).toBeTruthy();
  expect(modifiedPluginRow).toHaveAttribute("data-trait-origin", "plugin");
  expect(modifiedPluginRow).toHaveAttribute("data-trait-modified", "true");
  expect(
    within(modifiedPluginRow as HTMLElement).getByRole("img", {
      name: "Plugin category, modified",
    }),
  ).toBeTruthy();
  expect(customRow).toHaveAttribute("data-trait-origin", "custom");
  expect(
    within(customRow as HTMLElement).getByRole("img", {
      name: "Custom category",
    }),
  ).toBeTruthy();

  await user.click(
    within(availableMenu).getByRole("button", { name: "Custom behavior" }),
  );
  expect(
    screen.getByRole("dialog", { name: "Edit Custom behavior" }),
  ).toBeTruthy();
  expect(screen.getByText("Created in this app profile.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  await user.click(screen.getByRole("button", { name: "Add trait" }));
  availableMenu = await screen.findByRole("dialog", {
    name: "Available traits",
  });
  await user.click(
    within(availableMenu).getByRole("button", {
      name: "Unavailable behavior",
    }),
  );
  expect(
    screen.getByText(
      "Source: fixture. The saved source revision is unavailable.",
    ),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  await user.click(screen.getByRole("button", { name: "Plugin behavior" }));
  expect(screen.getByText("Modified Plugin trait")).toBeTruthy();
  expect(
    screen.getByText("Source: fixture. Differs from the current source."),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Reset to default" }));
  expect(screen.getByText("Plugin trait", { exact: true })).toBeTruthy();
  expect(
    screen.getByText("Source: fixture. Matches the current source."),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Save trait" }));
  expect(modifiedPluginRow).not.toHaveAttribute("data-trait-modified");
  control.dispose();
});
