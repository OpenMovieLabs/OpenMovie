import type { Task, TaskEvent, TaskPersistence } from '@openmovie/task-engine';
import type Database from 'better-sqlite3';

type TaskRow = { task_json: string };
type EventRow = {
  sequence: number;
  task_id: string;
  type: string;
  payload_json: string;
  created_at: string;
};

export class SqliteTaskPersistence implements TaskPersistence {
  constructor(private readonly database: Database.Database) {}

  loadTasks(): Task[] {
    return this.database
      .prepare('SELECT task_json FROM tasks ORDER BY created_at ASC')
      .all()
      .map((row) => JSON.parse((row as TaskRow).task_json) as Task);
  }

  saveTask(task: Task): void {
    this.database
      .prepare(
        `INSERT INTO tasks(id, goal, status, task_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           goal = excluded.goal,
           status = excluded.status,
           task_json = excluded.task_json,
           updated_at = excluded.updated_at`,
      )
      .run(task.id, task.goal, task.status, JSON.stringify(task), task.createdAt, task.updatedAt);
  }

  appendEvent(event: Omit<TaskEvent, 'sequence'>): TaskEvent {
    const result = this.database
      .prepare(
        `INSERT INTO task_events(task_id, type, payload_json, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(event.taskId, event.type, JSON.stringify(event.payload), event.createdAt);
    return { ...structuredClone(event), sequence: Number(result.lastInsertRowid) };
  }

  listEvents(taskId: string, afterSequence = 0): TaskEvent[] {
    return this.database
      .prepare(
        `SELECT sequence, task_id, type, payload_json, created_at
         FROM task_events
         WHERE task_id = ? AND sequence > ?
         ORDER BY sequence ASC`,
      )
      .all(taskId, afterSequence)
      .map((row) => {
        const event = row as EventRow;
        return {
          sequence: event.sequence,
          taskId: event.task_id,
          type: event.type,
          payload: JSON.parse(event.payload_json) as Record<string, unknown>,
          createdAt: event.created_at,
        };
      });
  }
}
