export interface PromptBudgetInput {
  systemPrompt: string;
  instructions: string[];
  guardrails: string[];
  contextTokens: number;
  executionProfile: string;
}

export interface PromptBudgetAnalysis {
  sections: {
    system: PromptSectionBudget;
    instructions: PromptSectionBudget;
    guardrails: PromptSectionBudget;
    total: PromptSectionBudget;
  };
  contextTokens: number;
  reservedRuntimeTokens: number;
  staticPromptBudgetTokens: number;
  estimatedStaticTokens: number;
  remainingStaticTokens: number;
  utilizationPercent: number;
  status: "healthy" | "attention" | "exceeded";
  estimator: "characters-divided-by-four";
}

interface PromptSectionBudget {
  characters: number;
  bytes: number;
  estimatedTokens: number;
}

const durableProfiles = new Set([
  "conversation", "consumer", "entity", "shared_shard", "temporary_durable"
]);

export function analyzePromptBudget(input: PromptBudgetInput): PromptBudgetAnalysis {
  if (!Number.isInteger(input.contextTokens) || input.contextTokens < 4_096) {
    throw new Error("Selected model context budget is unavailable");
  }
  const system = section(input.systemPrompt);
  const instructions = section(input.instructions.join("\n"));
  const guardrails = section(input.guardrails.map((item) => `Guardrail: ${item}`).join("\n"));
  const total = sum(system, instructions, guardrails);
  // Runtime reserve covers bounded request input, retrieved knowledge, tool schemas/results,
  // output, and—only for sticky actors—the bounded conversation/fact window.
  const requestedReserve = durableProfiles.has(input.executionProfile) ? 16_000 : 10_000;
  const reservedRuntimeTokens = Math.min(requestedReserve, Math.max(2_048, input.contextTokens - 2_048));
  const staticPromptBudgetTokens = Math.min(20_000,
    Math.max(2_048, input.contextTokens - reservedRuntimeTokens));
  const remainingStaticTokens = staticPromptBudgetTokens - total.estimatedTokens;
  const utilizationPercent = Math.round(total.estimatedTokens / staticPromptBudgetTokens * 1_000) / 10;
  return {
    sections: { system, instructions, guardrails, total },
    contextTokens: input.contextTokens,
    reservedRuntimeTokens,
    staticPromptBudgetTokens,
    estimatedStaticTokens: total.estimatedTokens,
    remainingStaticTokens,
    utilizationPercent,
    status: remainingStaticTokens < 0 ? "exceeded" : utilizationPercent >= 70 ? "attention" : "healthy",
    estimator: "characters-divided-by-four"
  };
}

export function assertPromptBudget(input: PromptBudgetInput) {
  const analysis = analyzePromptBudget(input);
  if (analysis.status === "exceeded") {
    throw new Error(`Static prompt estimate exceeds this model's ${analysis.staticPromptBudgetTokens.toLocaleString()} token release budget`);
  }
  return analysis;
}

function section(value: string): PromptSectionBudget {
  return {
    characters: value.length,
    bytes: new TextEncoder().encode(value).byteLength,
    estimatedTokens: Math.ceil(value.length / 4)
  };
}

function sum(...items: PromptSectionBudget[]): PromptSectionBudget {
  return {
    characters: items.reduce((total, item) => total + item.characters, 0),
    bytes: items.reduce((total, item) => total + item.bytes, 0),
    estimatedTokens: items.reduce((total, item) => total + item.estimatedTokens, 0)
  };
}
