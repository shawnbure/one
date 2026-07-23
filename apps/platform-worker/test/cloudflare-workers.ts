export class WorkflowEntrypoint<Env = unknown, _Params = unknown> {
  env!: Env;
}
export interface WorkflowEvent<T> { payload: T; instanceId: string }
export interface WorkflowStep { do<T>(name: string, callback: () => Promise<T>): Promise<T>; do<T>(name: string, options: unknown, callback: () => Promise<T>): Promise<T> }
