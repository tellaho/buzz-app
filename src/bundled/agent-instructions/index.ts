import type { PluginModule } from "../../plugins/api";
import before from "./before-projects.md?raw";
import after from "./after-projects.md?raw";

export const inject = ["agentInstructions"];

type Section = {
  id: string;
  title: string;
  category: "core" | "capabilities" | "communication" | "practice";
  order: number;
  marker: string | null;
};

const beforeSections: readonly Section[] = [
  {
    id: "buzz-identity",
    title: "Buzz identity",
    category: "core",
    order: 0,
    marker: null,
  },
  {
    id: "incoming-turn",
    title: "Incoming turn contract",
    category: "core",
    order: 10,
    marker: "## Incoming Turn Contract",
  },
  {
    id: "buzz-cli",
    title: "Buzz CLI",
    category: "core",
    order: 20,
    marker: "## Buzz CLI",
  },
];

const afterSections: readonly Section[] = [
  {
    id: "agent-creation",
    title: "Agent creation",
    category: "capabilities",
    order: 40,
    marker: "## Conversational Agent Creation",
  },
  {
    id: "mentions",
    title: "Mentions",
    category: "communication",
    order: 50,
    marker: "## Communication Patterns\n\n### Mentions",
  },
  {
    id: "callback-mentions",
    title: "Callback mentions",
    category: "communication",
    order: 60,
    marker: "### Callback Mentions",
  },
  {
    id: "threading",
    title: "Threading",
    category: "communication",
    order: 70,
    marker: "### Threading",
  },
  {
    id: "general-communication",
    title: "General communication",
    category: "communication",
    order: 80,
    marker: "### General",
  },
  {
    id: "workspace",
    title: "Workspace",
    category: "capabilities",
    order: 90,
    marker: "## Workspace Layout",
  },
  {
    id: "agent-memory",
    title: "Agent memory",
    category: "capabilities",
    order: 100,
    marker: "## Agent Memory",
  },
  {
    id: "engineering-discipline",
    title: "Engineering discipline",
    category: "practice",
    order: 110,
    marker: "## Engineering Discipline",
  },
  {
    id: "repository-workflow",
    title: "Repository workflow",
    category: "practice",
    order: 120,
    marker: "## Working in the Repo",
  },
  {
    id: "autonomy",
    title: "Autonomy",
    category: "practice",
    order: 130,
    marker: "## Autonomy",
  },
];

function body(text: string) {
  const lines = text.split("\n");
  let index = 0;
  while (index < lines.length && !lines[index]?.trim()) index++;
  while (index < lines.length && /^#{1,3}(?:\s|$)/u.test(lines[index] ?? "")) {
    index++;
    while (index < lines.length && !lines[index]?.trim()) index++;
  }
  return lines.slice(index).join("\n").trimEnd();
}

function sections(source: string, definitions: readonly Section[]) {
  return definitions.map((definition, index) => {
    const start = definition.marker ? source.indexOf(definition.marker) : 0;
    const next = definitions[index + 1]?.marker;
    const end = next ? source.indexOf(next, start + 1) : source.length;
    if (start < 0 || end < 0)
      throw new Error(`Missing bundled instruction section: ${definition.id}`);
    return { ...definition, text: body(source.slice(start, end)) };
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
