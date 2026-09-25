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
import { useState, useSyncExternalStore, type ReactNode } from "react";
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

async function renderBuilder({ withLeave = false } = {}) {
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
    const [left, setLeft] = useState(false);
    return (
      <BaseInstructions
        instructions={source}
        control={control}
        state={state}
        {...(withLeave
          ? {
              renderMain: (
                content: ReactNode,
                requestLeave: (leave: () => void) => void,
              ) =>
                left ? (
                  <p>Agents view</p>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => requestLeave(() => setLeft(true))}
                    >
                      Leave base prompt
                    </button>
                    {content}
                  </>
                ),
            }
          : {})}
      />
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
  expect(screen.getByRole("button", { name: "Plugin behavior" })).toBeVisible();
  expect(
    screen.queryByRole("list", {
      name: "Approximate prompt cost by category",
    }),
  ).toBeNull();

  await user.click(screen.getByRole("button", { name: "Custom behavior" }));
  const pane = screen.getByRole("complementary", { name: "Trait" });
  await user.click(within(pane).getByLabelText("Instructions"));
  fireEvent.change(screen.getByLabelText("Instructions"), {
    target: { value: "Edited custom instructions." },
  });
  await user.click(screen.getByRole("tab", { name: "All entries" }));
  expect(pane).toBeVisible();
  expect(within(pane).getByLabelText("Instructions")).toHaveValue(
    "Edited custom instructions.",
  );
  await user.click(within(pane).getByRole("button", { name: "Save trait" }));

  expect(screen.queryByLabelText("Category heading for Core")).toBeNull();
  expect(
    screen.getByRole("list", {
      name: "Approximate prompt cost by category",
    }),
  ).toBeVisible();
  expect(
    screen
      .getByRole("button", { name: "Plugin behavior" })
      .closest("[data-trait-key]"),
  ).toHaveStyle({ gridColumn: "span 2", gridRow: "span 2" });
  expect(
    within(
      screen.getByRole("region", { name: "Base prompt traits" }),
    ).getByRole("button", { name: "Custom behavior" }),
  ).toBeVisible();
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
  const createTrait = screen.getByRole("complementary", { name: "Trait" });
  expect(createTrait).toBeVisible();
  expect(within(createTrait).getByLabelText("Trait name")).toHaveFocus();
  await user.click(within(createTrait).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(createTrait).not.toBeInTheDocument());
  expect(
    screen.getByRole("dialog", { name: "Available traits" }),
  ).toBeVisible();
  await user.keyboard("{Escape}");
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
  let pane = screen.getByRole("complementary", { name: "Trait" });
  expect(within(pane).queryByLabelText("Trait name")).toBeNull();
  expect(within(pane).getByRole("document")).toBeVisible();
  expect(within(pane).queryByRole("button", { name: "Save trait" })).toBeNull();
  await user.click(within(pane).getByRole("button", { name: "Close trait" }));

  await user.click(
    screen.getByRole("button", { name: "Actions for Plugin behavior" }),
  );
  expect(await screen.findByRole("menuitem", { name: "View" })).toBeVisible();
  expect(screen.queryByRole("menuitem", { name: "Remove" })).toBeNull();
  await user.keyboard("{Escape}");

  await user.click(screen.getByRole("button", { name: "Default behavior" }));
  pane = screen.getByRole("complementary", { name: "Trait" });
  await user.click(within(pane).getByLabelText("Instructions"));
  expect(within(pane).getByLabelText("Trait name")).toBeEnabled();
  expect(within(pane).getByLabelText("Instructions")).toBeEnabled();
  fireEvent.change(within(pane).getByLabelText("Instructions"), {
    target: { value: "Edited default instructions." },
  });
  expect(
    within(pane).getByRole("button", { name: "Reset to default" }),
  ).toBeVisible();
  await user.click(
    within(pane).getByRole("button", { name: "Reset to default" }),
  );
  expect(within(pane).getByLabelText("Instructions")).toHaveValue(
    "Default instructions.",
  );
  expect(
    within(pane).getByRole("button", { name: "Save trait" }),
  ).toBeDisabled();
  fireEvent.change(within(pane).getByLabelText("Instructions"), {
    target: { value: "Edited default instructions." },
  });
  await user.click(within(pane).getByRole("button", { name: "Save trait" }));
  await user.click(within(pane).getByLabelText("Instructions"));
  await user.click(
    within(pane).getByRole("button", { name: "Reset to default" }),
  );
  expect(within(pane).getByLabelText("Instructions")).toHaveValue(
    "Default instructions.",
  );
  expect(
    within(pane).getByRole("button", { name: "Save trait" }),
  ).toBeEnabled();
  await user.click(within(pane).getByRole("button", { name: "Cancel" }));
  expect(within(pane).getByText("Edited default instructions.")).toBeVisible();

  await user.click(
    within(
      screen.getByRole("region", { name: "Base prompt traits" }),
    ).getByRole("button", { name: "Custom behavior" }),
  );
  pane = screen.getByRole("complementary", { name: "Trait" });
  await user.click(within(pane).getByLabelText("Instructions"));
  fireEvent.change(within(pane).getByLabelText("Instructions"), {
    target: { value: "## User-supplied heading" },
  });
  await user.click(within(pane).getByRole("button", { name: "Save trait" }));
  expect(screen.getByText(/Invalid entry/)).toBeVisible();

  fireEvent.change(within(pane).getByLabelText("Instructions"), {
    target: { value: "```md\n## Example heading\n```" },
  });
  await user.click(within(pane).getByRole("button", { name: "Save trait" }));
  expect(within(pane).queryByLabelText("Trait name")).toBeNull();
  expect(within(pane).getByText("## Example heading")).toBeVisible();
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

it("renders a sibling trait pane and restores focus without remounting the board", async () => {
  const { control, user, view } = await renderBuilder();
  const builder = screen.getByRole("region", { name: "Base prompt builder" });
  const category = screen.getByLabelText("Category heading for Custom");
  fireEvent.change(category, { target: { value: "Personal" } });
  const trigger = within(builder).getByRole("button", {
    name: "Custom behavior",
  });

  await user.click(trigger);
  const pane = screen.getByRole("complementary", { name: "Trait" });
  const frame = builder.parentElement?.parentElement;
  expect(screen.queryByRole("dialog", { name: /Custom behavior/ })).toBeNull();
  expect(frame).toBe(view.container.firstElementChild);
  expect(frame?.children).toHaveLength(2);
  expect(builder.parentElement).not.toBe(pane.parentElement);
  expect(screen.getByLabelText("Category heading for Personal")).toBeVisible();

  await user.click(trigger);
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.queryByRole("complementary", { name: "Trait" })).toBeNull();

  await user.click(trigger);
  const reopenedPane = screen.getByRole("complementary", { name: "Trait" });
  await user.click(
    within(reopenedPane).getByRole("button", { name: "Close trait" }),
  );
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.queryByRole("complementary", { name: "Trait" })).toBeNull();
  expect(screen.getByLabelText("Category heading for Personal")).toBeVisible();
  control.dispose();
});

it("uses one Save action for title-only, body-only, and combined edits", async () => {
  const { control, user } = await renderBuilder();
  const board = screen.getByRole("region", { name: "Base prompt traits" });
  await user.click(
    within(board).getByRole("button", { name: "Custom behavior" }),
  );
  let pane = screen.getByRole("complementary", { name: "Trait" });

  await user.click(
    within(pane).getByRole("button", { name: "Custom behavior" }),
  );
  expect(
    within(pane).getAllByRole("button", { name: "Save trait" }),
  ).toHaveLength(1);
  expect(
    within(pane).getByRole("button", { name: "Save trait" }),
  ).toBeDisabled();
  fireEvent.change(within(pane).getByLabelText("Trait name"), {
    target: { value: "Personal behavior" },
  });
  expect(
    within(pane).getByRole("button", { name: "Save trait" }),
  ).toBeEnabled();
  await user.click(within(pane).getByRole("button", { name: "Save trait" }));
  expect(
    within(board).getByRole("button", { name: "Personal behavior" }),
  ).toBeVisible();
  expect(within(pane).getByText("Custom instructions.")).toBeVisible();

  await user.click(within(pane).getByLabelText("Instructions"));
  fireEvent.change(within(pane).getByLabelText("Instructions"), {
    target: { value: "**Bold guidance.**\n\n<script>alert('no')</script>" },
  });
  await user.click(within(pane).getByRole("button", { name: "Save trait" }));
  expect(within(pane).getByText("Bold guidance.").tagName).toBe("STRONG");
  expect(pane.querySelector("script")).toBeNull();

  await user.click(
    within(pane).getByRole("button", { name: "Personal behavior" }),
  );
  fireEvent.change(within(pane).getByLabelText("Trait name"), {
    target: { value: "Canceled title" },
  });
  fireEvent.change(within(pane).getByLabelText("Instructions"), {
    target: { value: "Canceled body." },
  });
  await user.click(within(pane).getByRole("button", { name: "Cancel" }));
  expect(
    within(pane).getByRole("heading", { name: "Personal behavior" }),
  ).toBeVisible();
  expect(within(pane).getByText("Bold guidance.")).toBeVisible();

  await user.click(
    within(pane).getByRole("button", { name: "Personal behavior" }),
  );
  fireEvent.change(within(pane).getByLabelText("Trait name"), {
    target: { value: "Combined behavior" },
  });
  fireEvent.change(within(pane).getByLabelText("Instructions"), {
    target: { value: "Combined body." },
  });
  await user.click(within(pane).getByRole("button", { name: "Save trait" }));
  pane = screen.getByRole("complementary", { name: "Trait" });
  expect(
    within(pane).getByRole("heading", { name: "Combined behavior" }),
  ).toBeVisible();
  expect(within(pane).getByText("Combined body.")).toBeVisible();
  expect(
    within(board).getByRole("button", { name: "Combined behavior" }),
  ).toBeVisible();
  control.dispose();
});

it("guards dirty close, retarget, and Base prompt leave with one discard flow", async () => {
  const { control, user } = await renderBuilder({ withLeave: true });
  const board = screen.getByRole("region", { name: "Base prompt traits" });
  await user.click(
    within(board).getByRole("button", { name: "Custom behavior" }),
  );
  let pane = screen.getByRole("complementary", { name: "Trait" });
  await user.click(within(pane).getByLabelText("Instructions"));
  fireEvent.change(within(pane).getByLabelText("Instructions"), {
    target: { value: "Unsaved body." },
  });

  await user.keyboard("{Escape}");
  let confirmation = screen.getByRole("alertdialog");
  expect(confirmation).toHaveTextContent("Discard changes to Custom behavior?");
  await user.click(
    within(confirmation).getByRole("button", { name: "Keep editing" }),
  );
  expect(within(pane).getByLabelText("Instructions")).toHaveValue(
    "Unsaved body.",
  );

  await user.click(
    within(board).getByRole("button", { name: "Default behavior" }),
  );
  confirmation = screen.getByRole("alertdialog");
  await user.click(
    within(confirmation).getByRole("button", { name: "Keep editing" }),
  );
  expect(within(pane).getByLabelText("Instructions")).toHaveValue(
    "Unsaved body.",
  );
  await user.click(
    within(board).getByRole("button", { name: "Default behavior" }),
  );
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Discard changes",
    }),
  );
  pane = screen.getByRole("complementary", { name: "Trait" });
  expect(within(pane).getByText("Default instructions.")).toBeVisible();

  await user.click(within(pane).getByLabelText("Instructions"));
  fireEvent.change(within(pane).getByLabelText("Instructions"), {
    target: { value: "Another unsaved body." },
  });
  await user.click(screen.getByRole("button", { name: "Leave base prompt" }));
  expect(screen.queryByText("Agents view")).toBeNull();
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Discard changes",
    }),
  );
  expect(screen.getByText("Agents view")).toBeVisible();
  control.dispose();
});

it("cancels a new trait back to Available traits", async () => {
  const { control, user } = await renderBuilder();
  await user.click(screen.getByRole("tab", { name: "All entries" }));
  await user.click(screen.getByRole("button", { name: "Add trait" }));
  const library = screen.getByRole("dialog", { name: "Available traits" });
  await user.click(within(library).getByRole("button", { name: "New trait" }));
  const pane = screen.getByRole("complementary", { name: "Trait" });
  expect(within(pane).getByLabelText("Trait name")).toHaveFocus();
  fireEvent.change(within(pane).getByLabelText("Trait name"), {
    target: { value: "Abandoned trait" },
  });
  await user.click(within(pane).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("complementary", { name: "Trait" })).toBeNull();
  expect(
    screen.getByRole("dialog", { name: "Available traits" }),
  ).toBeVisible();
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
