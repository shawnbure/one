export class Agent<Env = unknown, State = unknown> {
  env!: Env; state!: State; sessionAffinity = "test";
}
export async function getAgentByName() { throw new Error("Agent execution is not used in control-plane tests"); }
