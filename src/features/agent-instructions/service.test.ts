import { afterEach, expect, it, vi } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { readFileSync } from "node:fs";
import { createPluginManager, type BundledPlugin } from "../../plugins/manager";
import { AgentInstructionsService } from "./service";
import { PagesService } from "../pages/service";
import { provideNavigation } from "../navigation/service";
import { provideRelay } from "../relay/service";
import * as base from "../../bundled/agent-instructions";
import * as projects from "../../bundled/projects";
import type { StorageResult } from "../../plugins/types";

const bundled: BundledPlugin[] = [
  {
    manifest: { id: "buzz.agent-instructions", name: "Base", apiVersion: 1 },
    module: base,
  },
  {
    manifest: { id: "buzz.projects", name: "Projects", apiVersion: 1 },
    module: projects,
  },
];
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
function setup(extra: BundledPlugin[] = []) {
  const ctx = new Context();
  const plugins = [...bundled, ...extra];
  let catalog: StorageResult = {
    status: "ready",
    externalPluginsPaused: false,
    catalog: {
      profile: "test",
      location: "test",
      plugins: plugins.map(({ manifest }) => ({
        manifest,
        source: "bundled",
        enabled: true,
        revision: "bundled",
        previous: null,
        reloadable: false,
        error: null,
      })),
    },
  };
  const manager = createPluginManager(ctx, {
    bundled: plugins,
    storage: {
      getCatalog: async () => catalog,
      changePlugin: async (action, id) => {
        if (catalog.status !== "ready") throw new Error("fixture");
        catalog = {
          ...catalog,
          catalog: {
            ...catalog.catalog,
            plugins: catalog.catalog.plugins.map((plugin) =>
              plugin.manifest.id === id
                ? { ...plugin, enabled: action === "enable" }
                : plugin,
            ),
          },
        };
        return catalog;
      },
      recoverSettings: async () => catalog,
      reloadPlugin: async () => catalog,
      readModule: async () => {
        throw new Error("not external");
      },
    },
  });
  const pages = new PagesService(ctx);
  provideNavigation(ctx);
  provideRelay(ctx);
  const service = new AgentInstructionsService(ctx, manager);
  cleanups.push(async () => {
    await Promise.all([manager.dispose(), ctx.fiber.dispose()]);
  });
  return { service, manager, pages };
}
it("composes the exact carryover and removes/restores Projects with plugin lifecycle", async () => {
  const { service, manager, pages } = setup();
  await vi.waitFor(() => expect(service.snapshot().error).toBeNull());
  const baseline = readFileSync(
    "crates/agent-controller/instructions/base.md",
    "utf8",
  );
  expect(
    service
      .snapshot()
      .composition.modules.map((m) => m.text)
      .join(""),
  ).toBe(baseline);
  const projectPage = () =>
    pages.snapshot().find((page) => page.pluginId === "buzz.projects");
  expect(projectPage()).toMatchObject({
    handlesNavigation: true,
    route: { version: 1 },
  });
  const snapshot = service.snapshot().composition;
  await manager.change("disable", "buzz.projects");
  await vi.waitFor(() => {
    expect(service.snapshot().error).toBeNull();
    expect(service.snapshot().composition.modules).toHaveLength(2);
    expect(projectPage()).toBeUndefined();
  });
  expect(
    service
      .snapshot()
      .composition.modules.map((m) => m.text)
      .join(""),
  ).not.toContain("## Projects\n");
  expect(
    service.snapshot().composition.plugins.find((p) => p.id === "buzz.projects")
      ?.enabled,
  ).toBe(false);
  expect(snapshot.modules).toHaveLength(3); // old captured proposal cannot mutate
  await manager.change("enable", "buzz.projects");
  await vi.waitFor(() =>
    expect(service.snapshot().composition.modules).toHaveLength(3),
  );
  expect(projectPage()).toMatchObject({
    handlesNavigation: true,
    route: { version: 1 },
  });
  expect(
    service
      .snapshot()
      .composition.modules.map((m) => m.text)
      .join(""),
  ).toBe(baseline);
});
it("blocks adoption while an enabled plugin fails rather than omitting its instructions silently", async () => {
  const { service, manager } = setup([
    {
      manifest: { id: "fixture.failed", name: "Failed", apiVersion: 1 },
      module: {
        apply: () => {
          throw new Error("fixture failure");
        },
      },
    },
  ]);
  await vi.waitFor(() =>
    expect(manager.snapshot().activation["fixture.failed"]?.status).toBe(
      "failed",
    ),
  );
  expect(service.snapshot().error).toContain("incomplete");
  await manager.change("disable", "fixture.failed");
  await vi.waitFor(() => expect(service.snapshot().error).toBeNull());
});
