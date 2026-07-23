import { modelProfiles, supportedWorkersAIModels, type PromptBundle } from "@workrr/contracts";
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import type { Env } from "./types";
import { buildExecutionTools, type ToolRuntimeContext, type ToolInvocationEvidence } from "./tool-runtime";

type ModelProfileName = keyof typeof modelProfiles;

export async function runModel(
  env: Env,
  profile: string,
  prompt: PromptBundle,
  input: string,
  sessionAffinity?: string,
  toolContext?: ToolRuntimeContext,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
  pinnedModelId?: string | null
): Promise<{ output: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number;
  toolInvocations: ToolInvocationEvidence[]; toolApprovalRequired: boolean }> {
  const selected = modelProfiles[(profile in modelProfiles ? profile : "balanced") as ModelProfileName];
  if (pinnedModelId && !supportedWorkersAIModels.includes(pinnedModelId as typeof supportedWorkersAIModels[number])) {
    throw new Error("Published release references an unsupported Workers AI model");
  }
  const modelId = pinnedModelId || selected.model;
  const system = [prompt.systemPrompt, ...prompt.instructions, ...prompt.guardrails.map((item) => `Guardrail: ${item}`)].join("\n");
  const workersAI = createWorkersAI({ binding: env.AI });
  const runtime = buildExecutionTools(env, toolContext);
  const messages: ModelMessage[] = [
    ...history.map((item) => ({ role: item.role, content: item.content }) satisfies ModelMessage),
    { role: "user", content: input }
  ];
  const { text, usage } = await generateText({
    model: workersAI(modelId, sessionAffinity ? { sessionAffinity } : {}),
    system,
    ...(history.length ? { messages } : { prompt: input }),
    tools: runtime.tools,
    stopWhen: runtime.tools ? stepCountIs(4) : stepCountIs(1)
  });

  return {
    output: text || "The model returned no text response.",
    model: modelId,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
    toolInvocations: runtime.evidence,
    toolApprovalRequired: runtime.evidence.some((item) => item.approvalRequired)
  };
}
