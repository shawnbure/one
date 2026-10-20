export interface CommandSearchItem {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  kind: "workspace" | "process";
  target: string;
}

const operatorWorkspaceLabels = [
  "Overview", "Launchpad", "Processes", "Opportunities", "Work inbox", "Activity",
  "API logs", "Connections", "Knowledge", "Evaluations", "Governance", "Notifications",
  "Value & decisions", "Usage & budgets", "Customer setup", "Team & roles", "Help Center"
] as const;

export function authorizedWorkspaceLabels(consumer: boolean) {
  return consumer ? ["Overview", "Launchpad", "Help Center"] : [...operatorWorkspaceLabels];
}

export function processVisibleInCommands(process: {
  status: string;
  activeReleaseId?: string | null;
  executionProfile: string;
}, consumer: boolean) {
  return !consumer || (process.status === "active" && Boolean(process.activeReleaseId) &&
    !["entity", "shared_shard"].includes(process.executionProfile));
}

export function searchCommands(items: CommandSearchItem[], query: string, limit = 10) {
  const needle = normalize(query);
  if (!needle) return items.slice(0, limit);
  return items
    .map((item, index) => ({ item, index, score: commandScore(item, needle) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ item }) => item);
}

function commandScore(item: CommandSearchItem, needle: string) {
  const label = normalize(item.label);
  const description = normalize(item.description);
  const keywords = normalize(item.keywords.join(" "));
  if (label === needle) return 100;
  if (label.startsWith(needle)) return 85;
  if (label.split(" ").some((word) => word.startsWith(needle))) return 70;
  if (label.includes(needle)) return 55;
  if (keywords.includes(needle)) return 35;
  if (description.includes(needle)) return 20;
  const tokens = needle.split(" ").filter(Boolean);
  const corpus = `${label} ${keywords} ${description}`;
  return tokens.length > 1 && tokens.every((token) => corpus.includes(token)) ? 15 : 0;
}

function normalize(value: string) {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}
