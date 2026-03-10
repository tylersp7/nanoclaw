import { EventEmitter } from 'events';

import { logger } from './logger.js';

export type LifecycleEvent =
  | 'session:start'
  | 'session:end'
  | 'session:output'
  | 'task:start'
  | 'task:end'
  | 'compaction:complete'
  | 'learning:indexed';

export interface SessionStartEvent {
  groupFolder: string;
  chatJid: string;
  sessionId?: string;
  isMain: boolean;
  isScheduledTask: boolean;
}

export interface SessionEndEvent {
  groupFolder: string;
  chatJid: string;
  sessionId?: string;
  durationMs: number;
  success: boolean;
  hadOutput: boolean;
}

export interface SessionOutputEvent {
  groupFolder: string;
  chatJid: string;
  text: string;
  isScheduledTask: boolean;
}

export interface TaskStartEvent {
  taskId: string;
  groupFolder: string;
  chatJid: string;
  prompt: string;
}

export interface TaskEndEvent {
  taskId: string;
  groupFolder: string;
  durationMs: number;
  success: boolean;
  resultSummary?: string;
}

export interface CompactionEvent {
  groupFolder: string;
  filename: string;
  messageCount: number;
}

export interface LearningIndexedEvent {
  groupFolder: string;
  filename: string;
  contentLength: number;
}

export interface LifecycleEventMap {
  'session:start': SessionStartEvent;
  'session:end': SessionEndEvent;
  'session:output': SessionOutputEvent;
  'task:start': TaskStartEvent;
  'task:end': TaskEndEvent;
  'compaction:complete': CompactionEvent;
  'learning:indexed': LearningIndexedEvent;
}

class LifecycleHooks {
  private emitter = new EventEmitter();

  on<K extends keyof LifecycleEventMap>(
    event: K,
    listener: (data: LifecycleEventMap[K]) => void,
  ): void {
    this.emitter.on(event, listener);
  }

  emit<K extends keyof LifecycleEventMap>(
    event: K,
    data: LifecycleEventMap[K],
  ): void {
    try {
      this.emitter.emit(event, data);
    } catch (err) {
      logger.warn({ event, err }, 'Lifecycle hook listener error');
    }
  }

  off<K extends keyof LifecycleEventMap>(
    event: K,
    listener: (data: LifecycleEventMap[K]) => void,
  ): void {
    this.emitter.off(event, listener);
  }
}

// Singleton
export const hooks = new LifecycleHooks();
