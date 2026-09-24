import type { PluginModule } from "../../plugins/api";
import before from "./before-projects.md?raw";
import after from "./after-projects.md?raw";

export const inject = ["agentInstructions"];

type Section = {
  id: string;
  title: string;
  order: number;
  marker: string | null;
};

const beforeSections: readonly Section[] = [
  { id: "buzz-identity", title: "Buzz identity", order: 0, marker: null },
  {
    id: "incoming-turn",
    title: "Incoming turn contract",
    order: 10,
    marker: "## Incoming Turn Contract",
  },
  { id: "buzz-cli", title: "Buzz CLI", order: 20, marker: "## Buzz CLI" },
];

const afterSections: readonly Section[] = [
  {
    id: "agent-creation",
    title: "Agent creation",
    order: 40,
    marker: "## Conversational Agent Creation",
  },
  {
    id: "mentions",
    title: "Mentions",
    order: 50,
    marker: "## Communication Patterns\n\n### Mentions",
  },
  {
    id: "callback-mentions",
    title: "Callback mentions",
    order: 60,
    marker: "### Callback Mentions",
  },
  { id: "threading", title: "Threading", order: 70, marker: "### Threading" },
  {
    id: "general-communication",
    title: "General communication",
    order: 80,
    marker: "### General",
  },
  {
    id: "workspace",
    title: "Workspace",
    order: 90,
    marker: "## Workspace Layout",
  },
  {
    id: "agent-memory",
    title: "Agent memory",
    order: 100,
    marker: "## Agent Memory",
  },
  {
    id: "engineering-discipline",
    title: "Engineering discipline",
    order: 110,
    marker: "## Engineering Discipline",
  },
  {
    id: "repository-workflow",
    title: "Repository workflow",
    order: 120,
    marker: "## Working in the Repo",
  },
  { id: "autonomy", title: "Autonomy", order: 130, marker: "## Autonomy" },
];

function sections(source: string, definitions: readonly Section[]) {
  return definitions.map((definition, index) => {
    const start = definition.marker ? source.indexOf(definition.marker) : 0;
    const next = definitions[index + 1]?.marker;
    const end = next ? source.indexOf(next, start + 1) : source.length;
    if (start < 0 || end < 0)
      throw new Error(`Missing bundled instruction section: ${definition.id}`);
    return { ...definition, text: source.slice(start, end) };
  });
}

export const apply: PluginModule["apply"] = (ctx) => {
  for (const module of [
    // Markdown formatters remove the boundary's second trailing newline.
    ...sections(`${before}\n`, beforeSections),
    ...sections(after, afterSections),
  ])
    ctx.agentInstructions.register(module);
};
