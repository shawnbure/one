import { modelProfiles, type PromptBundle } from "@workrr/contracts";
import { generateText, stepCountIs } from "ai";
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
  toolContext?: ToolRuntimeContext
): Promise<{ output: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number;
  toolInvocations: ToolInvocationEvidence[]; toolApprovalRequired: boolean }> {
  const selected = modelProfiles[(profile in modelProfiles ? profile : "balanced") as ModelProfileName];
  const system = [prompt.systemPrompt, ...prompt.instructions, ...prompt.guardrails.map((item) => `Guardrail: ${item}`)].join("\n");
  const workersAI = createWorkersAI({ binding: env.AI });
  const runtime = buildExecutionTools(env, toolContext);
  const { text, usage } = await generateText({
    model: workersAI(selected.model, sessionAffinity ? { sessionAffinity } : {}),
    system,
    prompt: input,
    tools: runtime.tools,
    stopWhen: runtime.tools ? stepCountIs(4) : stepCountIs(1)
  });

  return {
    output: text || "The model returned no text response.",
    model: selected.model,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
    toolInvocations: runtime.evidence,
    toolApprovalRequired: runtime.evidence.some((item) => item.approvalRequired)
  };
}
