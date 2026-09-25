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
    expect(screen.getByRole("status").textContent).toContain(
      "Saved revision 1",
    );
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
    expect(screen.getByRole("status").textContent).toContain(
      "Saved revision 2",
    ),
  );
  expect(host.adoptInstructions).toHaveBeenCalledWith(1, applied);
  expect(host.action).not.toHaveBeenCalled();
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

  expect(screen.queryByText("proposed instructions")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Core" }));
  expect(screen.getByRole("dialog", { name: "Edit Core" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  await user.click(screen.getByRole("button", { name: "Actions for Core" }));
  await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
  expect(screen.getByRole("dialog", { name: "Edit Core" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  await user.click(screen.getByRole("button", { name: "Actions for Core" }));
  await user.click(await screen.findByRole("menuitem", { name: "Move down" }));
  expect(
    [...view.container.querySelectorAll("[data-trait-key]")].map((row) =>
      row.getAttribute("data-trait-key"),
    ),
  ).toEqual(["fixture/second", "fixture/core"]);
  await user.click(screen.getByRole("button", { name: "Actions for Second" }));
  await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
  expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "New trait" }));
  fireEvent.change(screen.getByLabelText("Trait name"), {
    target: { value: "Curiosity" },
  });
  fireEvent.change(screen.getByLabelText("Instructions"), {
    target: { value: "Ask one useful question." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save trait" }));
  expect(screen.getByRole("button", { name: "Curiosity" })).toBeTruthy();
  await user.click(
    screen.getByRole("button", { name: "Actions for Curiosity" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
  expect(screen.getByRole("button", { name: "Delete Curiosity" })).toBeTruthy();
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
  const customRow = screen
    .getByRole("button", { name: "Custom behavior" })
    .closest("li");
  expect(defaultRow).toHaveAttribute("data-trait-origin", "default");
  expect(defaultRow).not.toHaveAttribute("data-trait-modified");
  expect(
    within(defaultRow as HTMLElement).getByRole("img", {
      name: "Default trait",
    }),
  ).toBeTruthy();
  expect(modifiedPluginRow).toHaveAttribute("data-trait-origin", "plugin");
  expect(modifiedPluginRow).toHaveAttribute("data-trait-modified", "true");
  expect(
    within(modifiedPluginRow as HTMLElement).getByRole("img", {
      name: "Plugin trait, modified",
    }),
  ).toBeTruthy();
  expect(customRow).toHaveAttribute("data-trait-origin", "custom");
  expect(
    within(customRow as HTMLElement).getByRole("img", {
      name: "Custom trait",
    }),
  ).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Custom behavior" }));
  expect(
    screen.getByRole("dialog", { name: "Edit Custom behavior" }),
  ).toBeTruthy();
  expect(screen.getByText("Created in this app profile.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  await user.click(
    screen.getByRole("button", { name: "Unavailable behavior" }),
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
