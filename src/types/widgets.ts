export interface TaskItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
}

/** Datos locales de los widgets (escritos por el usuario, nunca contenido remoto). */
export interface WidgetData {
  notes: string;
  tasks: TaskItem[];
}
