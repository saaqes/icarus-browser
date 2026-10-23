/** Datos de los widgets locales (notas y tareas). */

import type { TaskItem, WidgetData } from '../../types/widgets';
import type { DocumentSchema } from '../persistence/document';
import { STORAGE_KEYS } from '../persistence/keys';
import { isRecord, readIsoDate, readRecord, readString } from '../persistence/validation';

export const NOTES_MAX = 2000;
export const TASKS_MAX = 50;
export const TASK_TEXT_MAX = 120;

export function createDefaultWidgetData(): WidgetData {
  return { notes: '', tasks: [] };
}

export function sanitizeWidgetData(raw: unknown, issues: string[]): WidgetData {
  const value = readRecord(raw, 'widgets', issues);
  const notes = readString(value.notes, '', 'widgets.notes', issues, NOTES_MAX);
  const tasks: TaskItem[] = [];
  if (Array.isArray(value.tasks)) {
    value.tasks.slice(0, TASKS_MAX).forEach((item, index) => {
      if (
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.text === 'string' &&
        item.text.trim() &&
        item.text.length <= TASK_TEXT_MAX
      ) {
        tasks.push({
          id: item.id,
          text: item.text,
          done: item.done === true,
          createdAt: readIsoDate(item.createdAt, new Date(0).toISOString(), `widgets.tasks[${index}].createdAt`, []),
        });
      } else {
        issues.push(`widgets.tasks[${index}]`);
      }
    });
  } else if (value.tasks !== undefined) {
    issues.push('widgets.tasks');
  }
  return { notes, tasks };
}

export const widgetDataSchema: DocumentSchema<WidgetData> = {
  key: STORAGE_KEYS.widgets,
  version: 1,
  defaults: createDefaultWidgetData,
  sanitize: sanitizeWidgetData,
};

export function addTask(data: WidgetData, text: string, context: { id: string; now: Date }): WidgetData {
  const value = text.trim().slice(0, TASK_TEXT_MAX);
  if (!value || data.tasks.length >= TASKS_MAX) return data;
  return {
    ...data,
    tasks: [...data.tasks, { id: context.id, text: value, done: false, createdAt: context.now.toISOString() }],
  };
}

export function toggleTask(data: WidgetData, id: string): WidgetData {
  return { ...data, tasks: data.tasks.map((task) => (task.id === id ? { ...task, done: !task.done } : task)) };
}

export function removeTask(data: WidgetData, id: string): WidgetData {
  return { ...data, tasks: data.tasks.filter((task) => task.id !== id) };
}

export function clearCompletedTasks(data: WidgetData): WidgetData {
  return { ...data, tasks: data.tasks.filter((task) => !task.done) };
}

export function setNotes(data: WidgetData, notes: string): WidgetData {
  return { ...data, notes: notes.slice(0, NOTES_MAX) };
}
