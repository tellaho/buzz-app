import { Service, type Context } from "@deepseek-ai/cordis";
import {
  createContributions,
  type Contribution,
} from "../../plugins/contributions";
import type { PluginManager } from "../../plugins/manager";

export type InstructionModule = Readonly<{
  id: string;
  title: string;
  order: number;
  text: string;
}>;
export type SavedModule = Omit<Contribution<InstructionModule>, "id">;
export type InstructionComposition = {
  modules: readonly SavedModule[];
  plugins: readonly { id: string; revision: string; enabled: boolean }[];
};
export type SavedInstructions = {
  revision: number;
  composition: InstructionComposition;
  /** Missing only when an older running native host has not migrated yet. */
  inactiveModules?: readonly SavedModule[];
};
export type InstructionDraft = {
  composition: InstructionComposition;
  inactiveModules: readonly SavedModule[];
};
export type InstructionIdentity = { revision: number; sha256: string };
export type InstructionProposal = {
  composition: InstructionComposition;
  error: string | null;
};
export type AgentInstructions = {
  register(module: InstructionModule): void;
  snapshot(): InstructionProposal;
  subscribe(listener: () => void): () => void;
};
declare module "@deepseek-ai/cordis" {
  interface Context {
    agentInstructions: AgentInstructions;
  }
}

/** Contributions are candidates only. Adoption and execution belong to native control. */
export class AgentInstructionsService
  extends Service
  implements AgentInstructions
{
  private readonly contributions;
  private readonly listeners = new Set<() => void>();
  private state: InstructionProposal = {
    composition: { modules: [], plugins: [] },
    error: "Reading instruction plugins…",
  };
  constructor(ctx: Context, plugins: PluginManager) {
    super(ctx, "agentInstructions");
    this.contributions = createContributions<InstructionModule>(ctx);
    const publish = () => {
      const { configuration, busy, refreshError } = plugins.snapshot();
      const catalog =
        configuration.status === "ready" ? configuration.catalog.plugins : [];
      const modules = this.contributions
        .snapshot()
        .map(({ id: _id, ...module }) => module)
        .sort(
          (a, b) =>
            a.order - b.order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
        );
      const unavailable = catalog.some(
        (plugin) =>
          plugin.enabled &&
          (plugin.error ||
            !ctx.pluginStatus.isActive(plugin.manifest.id, plugin.revision)),
      );
      this.state = {
        composition: {
          modules,
          plugins: catalog
            .map((plugin) => ({
              id: plugin.manifest.id,
              revision: plugin.revision,
              enabled: plugin.enabled,
            }))
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
        },
        error:
          configuration.status !== "ready" ||
          busy ||
          refreshError ||
          unavailable
            ? "Plugin configuration is incomplete or changing. Resolve plugin errors before applying instructions."
            : !modules.length
              ? "Enable an instruction plugin before applying a base."
              : null,
      };
      for (const listener of this.listeners) listener();
    };
    ctx.effect(() => plugins.subscribe(publish));
    ctx.effect(() => this.contributions.subscribe(publish));
    publish();
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  register(module: InstructionModule) {
    if (
      !module ||
      !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(module.id) ||
      typeof module.title !== "string" ||
      !module.title.trim() ||
      new TextEncoder().encode(module.title).length > 256 ||
      !Number.isInteger(module.order) ||
      module.order < -2147483648 ||
      module.order > 2147483647 ||
      typeof module.text !== "string" ||
      module.text.includes("\0") ||
      new TextEncoder().encode(module.text).length > 1_048_576
    ) {
      throw new Error(
        "Invalid instruction module: use a bounded id, title, order and UTF-8 text",
      );
    }
    this.contributions.register(this.ctx, {
      id: module.id,
      title: module.title,
      order: module.order,
      text: module.text,
    });
  }
}
