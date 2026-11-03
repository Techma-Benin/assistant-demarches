import { isRetryable } from './errors.js';

export interface RetryRunnerOptions {
  /** Délai avant la tentative n+1 (n = nombre d’échecs déjà subis, à partir de 1). */
  delayMs: (failures: number) => number;
  maxAttempts: number;
  /** Appelé quand une tâche est abandonnée (erreur non retentable ou tentatives épuisées). */
  onGiveUp: (error: unknown, attempts: number, ref: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

interface Task {
  ref: string;
  run: (attempt: number) => Promise<void>;
}

/**
 * Exécute des tâches séquentiellement par clé (ordre conservé), avec nouvelle tentative sur erreur
 * retentable. En mémoire ; BullMQ/Redis remplacera ceci dans une tâche ultérieure.
 */
export class KeyedRetryRunner {
  private readonly lanes = new Map<string, Task[]>();
  private readonly running = new Set<Promise<void>>();
  private closed = false;
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: RetryRunnerOptions) {
    this.sleep =
      options.sleep ??
      ((ms) =>
        new Promise((resolve) => {
          const timer = setTimeout(() => {
            this.timers.delete(timer);
            resolve();
          }, ms);
          this.timers.add(timer);
        }));
  }

  submit(key: string, ref: string, run: (attempt: number) => Promise<void>): void {
    if (this.closed) return;
    const lane = this.lanes.get(key);
    if (lane) {
      lane.push({ ref, run });
      return;
    }
    this.lanes.set(key, [{ ref, run }]);
    // Démarrage différé : l’appelant (ex. réponse HTTP 204/200) termine d’abord.
    const promise = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => this.drain(key))
      .finally(() => this.running.delete(promise));
    this.running.add(promise);
  }

  private async drain(key: string): Promise<void> {
    const lane = this.lanes.get(key)!;
    while (lane.length > 0 && !this.closed) {
      const task = lane[0]!;
      let attempt = 0;
      for (;;) {
        try {
          await task.run(attempt);
          break;
        } catch (error) {
          attempt += 1;
          if (!isRetryable(error) || attempt >= this.options.maxAttempts || this.closed) {
            this.options.onGiveUp(error, attempt, task.ref);
            break;
          }
          await this.sleep(this.options.delayMs(attempt));
        }
      }
      lane.shift();
    }
    this.lanes.delete(key);
  }

  /** Résout quand toutes les tâches soumises sont terminées (tests, arrêt propre). */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running]);
  }

  close(): void {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}
