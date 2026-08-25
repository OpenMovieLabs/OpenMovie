import { createId } from '@openmovie/movie-ir';

export type TaskStatus =
  'queued' | 'planning' | 'awaiting_approval' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type TaskStep = {
  id: string;
  kind: string;
  title: string;
  input: Record<string, unknown>;
  status: StepStatus;
  attempt: number;
  output?: unknown;
  error?: string;
};

export type Task = {
  id: string;
  goal: string;
  status: TaskStatus;
  steps: TaskStep[];
  createdAt: string;
  updatedAt: string;
  error?: string;
};

export type TaskEvent = {
  sequence: number;
  taskId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type StepHandler = (
  input: Record<string, unknown>,
  context: { signal: AbortSignal; task: Task; step: TaskStep },
) => Promise<unknown>;

const taskTransitions: Record<TaskStatus, TaskStatus[]> = {
  queued: ['planning', 'cancelled'],
  planning: ['awaiting_approval', 'running', 'failed', 'cancelled'],
  awaiting_approval: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: ['queued', 'cancelled'],
  cancelled: ['queued'],
};

export class TaskEngine {
  private readonly tasks = new Map<string, Task>();
  private readonly handlers = new Map<string, StepHandler>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly events: TaskEvent[] = [];
  private sequence = 0;

  registerStep(kind: string, handler: StepHandler): void {
    if (this.handlers.has(kind)) throw new Error(`Step handler already registered: ${kind}`);
    this.handlers.set(kind, handler);
  }

  create(goal: string, steps: Array<Omit<TaskStep, 'id' | 'status' | 'attempt'>>): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id: createId('task'),
      goal,
      status: 'queued',
      steps: steps.map((step) => ({
        ...step,
        id: createId('step'),
        status: 'pending',
        attempt: 0,
      })),
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    this.emit(task.id, 'task.created', { goal });
    return structuredClone(task);
  }

  get(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return structuredClone(task);
  }

  list(): Task[] {
    return [...this.tasks.values()].map((task) => structuredClone(task));
  }

  listEvents(taskId: string, afterSequence = 0): TaskEvent[] {
    return this.events
      .filter((event) => event.taskId === taskId && event.sequence > afterSequence)
      .map((event) => structuredClone(event));
  }

  async run(taskId: string): Promise<Task> {
    const task = this.requireTask(taskId);
    if (task.status === 'failed' || task.status === 'cancelled') this.resetSteps(task);
    this.transition(task, 'planning');
    this.transition(task, 'running');
    const controller = new AbortController();
    this.controllers.set(taskId, controller);

    try {
      for (const step of task.steps) {
        if (controller.signal.aborted) throw new DOMException('Task cancelled', 'AbortError');
        const handler = this.handlers.get(step.kind);
        if (!handler) throw new Error(`No handler registered for step kind: ${step.kind}`);
        step.status = 'running';
        step.attempt += 1;
        this.touch(task);
        this.emit(task.id, 'step.started', {
          stepId: step.id,
          kind: step.kind,
          attempt: step.attempt,
        });
        try {
          step.output = await handler(step.input, { signal: controller.signal, task, step });
          step.status = 'succeeded';
          delete step.error;
          this.emit(task.id, 'step.succeeded', { stepId: step.id });
        } catch (error) {
          if (controller.signal.aborted) throw error;
          step.status = 'failed';
          step.error = error instanceof Error ? error.message : String(error);
          throw error;
        }
      }
      this.transition(task, 'succeeded');
    } catch (error) {
      if (controller.signal.aborted) {
        for (const step of task.steps.filter((item) => item.status === 'running'))
          step.status = 'cancelled';
        this.transition(task, 'cancelled');
      } else {
        task.error = error instanceof Error ? error.message : String(error);
        this.transition(task, 'failed');
      }
    } finally {
      this.controllers.delete(taskId);
    }
    return structuredClone(task);
  }

  cancel(taskId: string): Task {
    const task = this.requireTask(taskId);
    const controller = this.controllers.get(taskId);
    if (controller) controller.abort();
    else if (task.status !== 'succeeded' && task.status !== 'cancelled')
      this.transition(task, 'cancelled');
    return structuredClone(task);
  }

  private transition(task: Task, next: TaskStatus): void {
    if (!taskTransitions[task.status].includes(next)) {
      throw new Error(`Invalid task transition: ${task.status} -> ${next}`);
    }
    const previous = task.status;
    task.status = next;
    this.touch(task);
    this.emit(task.id, 'task.status_changed', { previous, next });
  }

  private resetSteps(task: Task): void {
    for (const step of task.steps) {
      if (step.status !== 'succeeded') {
        step.status = 'pending';
        delete step.error;
      }
    }
    delete task.error;
    this.transition(task, 'queued');
  }

  private requireTask(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }

  private touch(task: Task): void {
    task.updatedAt = new Date().toISOString();
  }

  private emit(taskId: string, type: string, payload: Record<string, unknown>): void {
    this.events.push({
      sequence: ++this.sequence,
      taskId,
      type,
      payload,
      createdAt: new Date().toISOString(),
    });
  }
}
