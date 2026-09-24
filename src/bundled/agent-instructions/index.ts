import type { PluginModule } from "../../plugins/api";
import before from "./before-projects.md?raw";
import after from "./after-projects.md?raw";

export const inject = ["agentInstructions"];
export const apply: PluginModule["apply"] = (ctx) => {
  ctx.agentInstructions.register({
    id: "before-projects",
    title: "Buzz and CLI",
    order: 0,
    text: before,
  });
  ctx.agentInstructions.register({
    id: "after-projects",
    title: "Agent behavior",
    order: 20,
    text: after,
  });
};
