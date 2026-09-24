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
it("requires explicit adoption, retains saved state on failure and never restarts", async () => {
  const fixture = controlFixture();
  const saved = {
    revision: 1,
    composition: {
      ...proposal.composition,
      modules: proposal.composition.modules.map((module) => ({
        ...module,
        text: "saved instructions",
      })),
    },
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
  fireEvent.click(screen.getByText("Base instructions for all local agents"));
  fireEvent.click(
    screen.getByRole("button", { name: "Apply base instructions" }),
  );
  await waitFor(() =>
    expect(screen.getByText(/Could not confirm adoption/)).toBeTruthy(),
  );
  expect(host.adoptInstructions).toHaveBeenCalledWith(1, proposal.composition);
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
  };
  const before = { agents: [], runtimeAvailable: true, instructions: saved };
  const after = {
    ...before,
    instructions: { revision: 2, composition: proposal.composition },
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
  fireEvent.click(screen.getByText("Base instructions for all local agents"));
  fireEvent.click(
    screen.getByRole("button", { name: "Apply base instructions" }),
  );
  try {
    await waitFor(() => expect(host.adoptInstructions).toHaveBeenCalledOnce());
    expect(screen.getByRole("status").textContent).toContain(
      "Saved revision 1",
    );
    expect(
      screen
        .getByRole("button", { name: "Apply base instructions" })
        .hasAttribute("disabled"),
    ).toBe(true);
  } finally {
    confirm(after);
  }
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "Saved revision 2",
    ),
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Proposal matches saved instructions.",
  );
  expect(host.action).not.toHaveBeenCalled();
  control.dispose();
});
