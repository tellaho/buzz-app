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
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type {
  AgentInstructions,
  InstructionDraft,
  InstructionProposal,
  SavedInstructions,
} from "../../features/agent-instructions/service";
import { DEFAULT_INSTRUCTION_CATEGORIES } from "../../features/agent-instructions/service";
import { createAgentControl } from "../../features/agents/control";
import { controlFixture } from "../../features/agents/control-testing";
import { BaseInstructions } from "./BaseInstructions";
import {
  DEFAULT_INSTRUCTIONS_PLUGIN,
  LOCAL_INSTRUCTIONS_PLUGIN,
  LOCAL_INSTRUCTIONS_REVISION,
} from "./base-instruction-draft";

afterEach(cleanup);

const categories = DEFAULT_INSTRUCTION_CATEGORIES.map((category) => ({
  ...category,
}));
const pluginModule = {
  key: "fixture/plugin",
  title: "Plugin behavior",
  pluginId: "fixture",
  revision: "v1",
  order: 0,
  category: "core",
  text: "x".repeat(4_000),
};
const defaultModule = {
  key: `${DEFAULT_INSTRUCTIONS_PLUGIN}/default`,
  title: "Default behavior",
  pluginId: DEFAULT_INSTRUCTIONS_PLUGIN,
  revision: "bundled",
  order: 10,
  category: "core",
  text: "Default instructions.",
};
const customModule = {
  key: `${LOCAL_INSTRUCTIONS_PLUGIN}/custom`,
  title: "Custom behavior",
  pluginId: LOCAL_INSTRUCTIONS_PLUGIN,
  revision: LOCAL_INSTRUCTIONS_REVISION,
  order: 20,
  category: "custom",
  text: "Custom instructions.",
};
const proposal: InstructionProposal = {
  composition: {
    categories,
    modules: [pluginModule, defaultModule],
    plugins: [
      { id: DEFAULT_INSTRUCTIONS_PLUGIN, revision: "bundled", enabled: true },
      { id: "fixture", revision: "v1", enabled: true },
    ],
  },
  error: null,
};
const saved: SavedInstructions = {
  revision: 1,
  composition: {
    categories,
    modules: [pluginModule, defaultModule, customModule],
    plugins: [
      {
        id: DEFAULT_INSTRUCTIONS_PLUGIN,
        revision: "bundled",
        enabled: true,
      },
      {
        id: LOCAL_INSTRUCTIONS_PLUGIN,
        revision: LOCAL_INSTRUCTIONS_REVISION,
        enabled: true,
      },
      { id: "fixture", revision: "v1", enabled: true },
    ],
  },
  inactiveModules: [],
};

async function renderBuilder() {
  const fixture = controlFixture();
  const adoptInstructions = vi.fn(
    async (_revision: number, draft: InstructionDraft) => ({
      agents: [],
      runtimeAvailable: true,
      instructions: { revision: 2, ...draft },
    }),
  );
  const host = {
    ...fixture.host,
    snapshot: async () => ({
      agents: [],
      runtimeAvailable: true,
      instructions: saved,
    }),
    adoptInstructions,
  };
  const control = createAgentControl(host);
  await control.refresh();
  const source: AgentInstructions = {
    register() {},
    snapshot: () => proposal,
    subscribe: () => () => {},
  };
  function Harness() {
    const state = useSyncExternalStore(control.subscribe, control.snapshot);
    return (
      <BaseInstructions instructions={source} control={control} state={state} />
    );
  }
  const view = render(<Harness />);
  return { adoptInstructions, control, user: userEvent.setup(), view };
}

it("shares one editable draft between Sections and All entries", async () => {
  const { adoptInstructions, control, user } = await renderBuilder();

  expect(screen.getByRole("tab", { name: "Sections" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    screen.getByRole("button", { name: "Reset all to default" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Apply base prompt" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Add trait" })).toBeNull();
  expect(screen.getByLabelText("Category heading for Core")).toBeVisible();
  expect(
    screen
      .getByRole("button", { name: "Plugin behavior" })
      .closest("[data-trait-key]"),
  ).toHaveStyle({ gridColumn: "span 1", gridRow: "span 2" });
  expect(
    screen.queryByRole("list", {
      name: "Approximate prompt cost by category",
    }),
  ).toBeNull();

  await user.click(screen.getByRole("button", { name: "Custom behavior" }));
  fireEvent.change(screen.getByLabelText("Instructions"), {
    target: { value: "Edited custom instructions." },
  });
  await user.click(screen.getByRole("tab", { name: "All entries" }));
  expect(
    screen.getByRole("dialog", { name: "Edit Custom behavior" }),
  ).toBeVisible();
  expect(screen.getByLabelText("Instructions")).toHaveValue(
    "Edited custom instructions.",
  );
  await user.click(screen.getByRole("button", { name: "Save trait" }));

  expect(screen.queryByLabelText("Category heading for Core")).toBeNull();
  expect(
    screen.getByRole("list", {
      name: "Approximate prompt cost by category",
    }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Plugin behavior" })).toBeVisible();
  expect(
    screen
      .getByRole("button", { name: "Plugin behavior" })
      .closest("[data-trait-key]"),
  ).toHaveStyle({ gridColumn: "span 2", gridRow: "span 2" });
  expect(screen.getByRole("button", { name: "Custom behavior" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Add trait" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Apply base prompt" }));

  await waitFor(() => expect(adoptInstructions).toHaveBeenCalledOnce());
  const applied = adoptInstructions.mock.calls[0]?.[1];
  expect(applied?.composition.modules).toContainEqual(
    expect.objectContaining({
      key: customModule.key,
      category: "custom",
      text: "Edited custom instructions.",
    }),
  );
  expect(screen.getByText(/Running agents were not restarted/)).toBeVisible();
  control.dispose();
});

it("resets the whole draft to current source defaults before applying", async () => {
  const { adoptInstructions, control, user } = await renderBuilder();

  await user.click(
    screen.getByRole("button", { name: "Reset all to default" }),
  );
  expect(screen.queryByRole("button", { name: "Custom behavior" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Apply base prompt" }),
  ).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Apply base prompt" }));
  await waitFor(() => expect(adoptInstructions).toHaveBeenCalledOnce());
  expect(
    adoptInstructions.mock.calls[0]?.[1].composition.modules,
  ).not.toContainEqual(expect.objectContaining({ key: customModule.key }));
  control.dispose();
});

it("edits category headings and tones while omitting empty categories from All entries", async () => {
  const { adoptInstructions, control, user } = await renderBuilder();

  const coreHeading = screen.getByLabelText("Category heading for Core");
  fireEvent.change(coreHeading, {
    target: { value: "" },
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    /headings must be non-empty single lines/,
  );
  expect(
    screen.getByRole("button", { name: "Apply base prompt" }),
  ).toBeDisabled();
  fireEvent.change(coreHeading, {
    target: { value: "Principles" },
  });
  await user.click(
    screen.getByRole("button", { name: "Change color for Principles" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "Red" }));
  await user.click(
    screen.getByRole("button", { name: "Actions for Principles" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "Move later" }));
  expect(screen.queryByRole("button", { name: "Add category" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Add to Principles" }));
  expect(
    await screen.findByRole("menuitem", { name: "Add trait" }),
  ).toBeVisible();
  await user.click(screen.getByRole("menuitem", { name: "Add trait" }));
  const createTrait = screen.getByRole("dialog", { name: "Create trait" });
  expect(createTrait).toBeVisible();
  await user.click(within(createTrait).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(createTrait).not.toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "Add to Principles" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Add category" }),
  );
  expect(
    screen.getByLabelText("Category heading for New category"),
  ).toBeVisible();

  await user.click(screen.getByRole("tab", { name: "All entries" }));
  const legend = screen.getByRole("list", {
    name: "Approximate prompt cost by category",
  });
  expect(within(legend).getByText("Principles")).toBeVisible();
  expect(within(legend).queryByText("New category")).toBeNull();

  await user.click(screen.getByRole("button", { name: "Apply base prompt" }));
  await waitFor(() => expect(adoptInstructions).toHaveBeenCalledOnce());
  expect(adoptInstructions.mock.calls[0]?.[1].composition.categories).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "core", title: "Principles", tone: "red" }),
      expect.objectContaining({ title: "New category" }),
    ]),
  );
  expect(
    (adoptInstructions.mock.calls[0]?.[1].composition.categories ?? [])
      .slice(0, 2)
      .map((category) => category.id),
  ).toEqual(["capabilities", "core"]);
  control.dispose();
});

it("deletes custom entries with their category and rehomes plugin entries", async () => {
  const { adoptInstructions, control, user } = await renderBuilder();

  await user.click(screen.getByRole("button", { name: "Actions for Custom" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Delete category" }),
  );
  await user.click(screen.getByRole("button", { name: "Delete category" }));
  expect(screen.queryByLabelText("Category heading for Custom")).toBeNull();
  expect(screen.queryByRole("button", { name: "Custom behavior" })).toBeNull();

  await user.click(screen.getByRole("button", { name: "Actions for Core" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Delete category" }),
  );
  await user.click(screen.getByRole("button", { name: "Delete category" }));
  expect(screen.queryByLabelText("Category heading for Core")).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Plugin behavior" })
      .closest("[data-trait-key]"),
  ).toHaveAttribute("data-category-tone", "slate");

  await user.click(screen.getByRole("button", { name: "Apply base prompt" }));
  await waitFor(() => expect(adoptInstructions).toHaveBeenCalledOnce());
  const applied = adoptInstructions.mock.calls[0]?.[1];
  expect(
    (applied?.composition.categories ?? []).map((category) => category.id),
  ).not.toEqual(expect.arrayContaining(["core", "custom"]));
  expect(applied?.composition.modules).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: pluginModule.key,
        category: "uncategorized",
      }),
      expect.objectContaining({
        key: defaultModule.key,
        category: "uncategorized",
      }),
    ]),
  );
  control.dispose();
});

it("edits bundled defaults, keeps plugin entries read-only and validates bodies", async () => {
  const { adoptInstructions, control, user } = await renderBuilder();

  await user.click(screen.getByRole("button", { name: "Plugin behavior" }));
  expect(screen.getByLabelText("Trait name")).toBeDisabled();
  expect(screen.getByLabelText("Instructions")).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Save trait" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  await user.click(
    screen.getByRole("button", { name: "Actions for Plugin behavior" }),
  );
  expect(await screen.findByRole("menuitem", { name: "View" })).toBeVisible();
  expect(screen.queryByRole("menuitem", { name: "Remove" })).toBeNull();
  await user.keyboard("{Escape}");

  await user.click(screen.getByRole("button", { name: "Default behavior" }));
  expect(screen.getByLabelText("Trait name")).toBeEnabled();
  expect(screen.getByLabelText("Instructions")).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Instructions"), {
    target: { value: "Edited default instructions." },
  });
  expect(
    screen.getByRole("button", { name: "Reset to default" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Save trait" }));

  await user.click(screen.getByRole("button", { name: "Custom behavior" }));
  fireEvent.change(screen.getByLabelText("Instructions"), {
    target: { value: "## User-supplied heading" },
  });
  await user.click(screen.getByRole("button", { name: "Save trait" }));
  expect(screen.getByText(/Invalid entry/)).toBeVisible();

  fireEvent.change(screen.getByLabelText("Instructions"), {
    target: { value: "```md\n## Example heading\n```" },
  });
  await user.click(screen.getByRole("button", { name: "Save trait" }));
  expect(
    screen.queryByRole("dialog", { name: "Edit Custom behavior" }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Apply base prompt" }));
  await waitFor(() => expect(adoptInstructions).toHaveBeenCalledOnce());
  expect(
    adoptInstructions.mock.calls[0]?.[1].composition.modules,
  ).toContainEqual(
    expect.objectContaining({
      key: defaultModule.key,
      text: "Edited default instructions.",
    }),
  );
  control.dispose();
});

it("reclassifies by dragging in Sections and rejects cross-category dragging in All entries", async () => {
  const { control, user, view } = await renderBuilder();
  const originalElementsFromPoint = document.elementsFromPoint;
  const dragOnto = (
    source: HTMLElement,
    target: HTMLElement,
    pointerId: number,
  ) => {
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [target],
    });
    fireEvent.pointerDown(source, {
      button: 0,
      clientX: 10,
      clientY: 10,
      isPrimary: true,
      pointerId,
    });
    fireEvent.pointerMove(source, {
      clientX: 30,
      clientY: 30,
      isPrimary: true,
      pointerId,
    });
    fireEvent.pointerUp(source, { pointerId });
  };

  try {
    await user.click(screen.getByRole("tab", { name: "All entries" }));
    let pluginRow = screen
      .getByRole("button", { name: "Plugin behavior" })
      .closest<HTMLElement>("[data-trait-key]");
    let customRow = screen
      .getByRole("button", { name: "Custom behavior" })
      .closest<HTMLElement>("[data-trait-key]");
    if (!pluginRow || !customRow) throw new Error("Expected instruction cards");
    dragOnto(customRow, pluginRow, 7);
    expect(customRow).toHaveAttribute("data-category-tone", "amber");

    await user.click(screen.getByRole("tab", { name: "Sections" }));
    pluginRow = screen
      .getByRole("button", { name: "Plugin behavior" })
      .closest<HTMLElement>("[data-trait-key]");
    customRow = screen
      .getByRole("button", { name: "Custom behavior" })
      .closest<HTMLElement>("[data-trait-key]");
    if (!pluginRow || !customRow) throw new Error("Expected instruction cards");
    dragOnto(customRow, pluginRow, 8);
    expect(
      view.container.querySelector(`[data-trait-key="${customModule.key}"]`),
    ).toHaveAttribute("data-category-tone", "purple");

    customRow = screen
      .getByRole("button", { name: "Custom behavior" })
      .closest<HTMLElement>("[data-trait-key]");
    const emptyCategory = screen.getByLabelText("Uncategorized is empty");
    if (!customRow || !emptyCategory)
      throw new Error("Expected empty category heading");
    dragOnto(customRow, emptyCategory, 9);
    expect(
      view.container.querySelector(`[data-trait-key="${customModule.key}"]`),
    ).toHaveAttribute("data-category-tone", "slate");
  } finally {
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: originalElementsFromPoint,
    });
  }
  control.dispose();
});
