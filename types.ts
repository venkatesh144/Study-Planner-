export type PlannerCategory = 'STUDY' | 'REVISION' | 'TEST';
export type ViewMode = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type PriorityLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type ThemeMode = 'LIGHT' | 'DARK' | 'READING';

export interface Task {
  id: string;
  title: string;
  category: PlannerCategory;
  date: Date;
  time?: string; // HH:MM format
  durationMinutes: number;
  completed: boolean;
  subject: string;
  notes?: string;
  priority?: PriorityLevel;
  link?: string;
  reminderMinutes?: number; // Minutes before due time to remind
  reminderSent?: boolean;
}

export interface ChartDataPoint {
  name: string;
  value: number;
  fill?: string;
}

export enum AISuggestionType {
  PLAN = 'PLAN',
  MOTIVATION = 'MOTIVATION'
}