// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BaseInstructions } from "./BaseInstructions";
import type {
  AgentInstructions,
  InstructionProposal,
} from "../../features/agent-instructions/service";
import { createAgentControl } from "../../features/agents/control";
import { useSyncExternalStore } from "react";
import { controlFixture } from "../../features/agents/control-testing";

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
  fireEvent.click(screen.getByRole("button", { name: "Edit Core" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Edit Core" }));
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

  fireEvent.click(screen.getByRole("button", { name: "Move Core down" }));
  expect(
    [...view.container.querySelectorAll("[data-trait-key]")].map((row) =>
      row.getAttribute("data-trait-key"),
    ),
  ).toEqual(["fixture/second", "fixture/core"]);
  fireEvent.click(screen.getByRole("button", { name: "Remove Second" }));
  expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "New trait" }));
  fireEvent.change(screen.getByLabelText("Trait name"), {
    target: { value: "Curiosity" },
  });
  fireEvent.change(screen.getByLabelText("Instructions"), {
    target: { value: "Ask one useful question." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save trait" }));
  expect(screen.getByRole("button", { name: "Edit Curiosity" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove Curiosity" }));
  expect(screen.getByRole("button", { name: "Delete Curiosity" })).toBeTruthy();
  control.dispose();
});
