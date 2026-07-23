import { modelProfiles, type PromptBundle } from "@workrr/contracts";
import { generateText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import type { Env } from "./types";

type ModelProfileName = keyof typeof modelProfiles;

export async function runModel(
  env: Env,
  profile: string,
  prompt: PromptBundle,
  input: string,
  sessionAffinity?: string
): Promise<{ output: string; model: string }> {
  const selected = modelProfiles[(profile in modelProfiles ? profile : "balanced") as ModelProfileName];
  const system = [prompt.systemPrompt, ...prompt.instructions, ...prompt.guardrails.map((item) => `Guardrail: ${item}`)].join("\n");
  const workersAI = createWorkersAI({ binding: env.AI });
  const { text } = await generateText({
    model: workersAI(selected.model, sessionAffinity ? { sessionAffinity } : {}),
    system,
    prompt: input
  });

  return {
    output: text || "The model returned no text response.",
    model: selected.model
  };
}
