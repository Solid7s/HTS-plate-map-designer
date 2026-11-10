/// <reference types="vite/client" />
import PlateAiWorker from '../workers/plate-ai.worker?worker';
import { AI_MODEL_F16, AI_MODEL_F32 } from './ai-experiment';
import type { AiWorkerRequest, AiWorkerResponse } from './ai-experiment';

type GpuNavigator = Navigator & { gpu?: { requestAdapter(options?: { powerPreference: string }): Promise<{ features: { has(name: string): boolean } } | null> } };
export async function browserAiModel(): Promise<string | null> {
  if (!window.isSecureContext || !(navigator as GpuNavigator).gpu) return null;
  try {
    const adapter = await (navigator as GpuNavigator).gpu!.requestAdapter({ powerPreference: 'high-performance' });
    return adapter ? adapter.features.has('shader-f16') ? AI_MODEL_F16 : AI_MODEL_F32 : null;
  } catch { return null; }
}

export function friendlyAiError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/out of.*memory|allocation|buffer.*size|device.*lost|GPUDevice|GPU.*error/i.test(message)) return 'The browser could not keep the model in GPU memory. Close other GPU-heavy tabs, then enable AI again. Manual planning is still available.';
  if (/fetch|network|download|cache|storage|quota/i.test(message)) return 'The model download or browser storage failed. Check your connection and free storage, then try again. Manual planning is still available.';
  return message.length > 240 ? 'Browser AI could not finish. Disable AI, enable it again, and try a shorter description.' : message;
}

export class BrowserAi {
  private worker: Worker | null = null;
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private onProgress?: (progress: number, text: string) => void;

  async load(model: string, onProgress: (progress: number, text: string) => void) {
    this.stop();
    this.onProgress = onProgress;
    this.worker = new PlateAiWorker();
    this.worker.onmessage = ({ data }: MessageEvent<AiWorkerResponse>) => {
      if (data.type === 'progress') { this.onProgress?.(Math.max(0, Math.min(1, data.progress)), data.text); return; }
      const request = this.pending.get(data.id);
      if (!request) return;
      clearTimeout(request.timer); this.pending.delete(data.id);
      if (data.type === 'error') request.reject(new Error(data.message));
      else request.resolve(data.type === 'result' ? data.text : '');
    };
    this.worker.onerror = () => this.stop('The browser AI worker stopped. Try enabling AI again.');
    this.worker.onmessageerror = () => this.stop('The browser could not read the AI response. Try enabling AI again.');
    await this.request({ id: ++this.nextId, type: 'load', model }, 10 * 60_000);
  }

  extract(prompt: string) { return this.request({ id: ++this.nextId, type: 'extract', prompt }, 120_000); }

  private request(message: AiWorkerRequest, timeout: number): Promise<string> {
    if (!this.worker) return Promise.reject(new Error('Enable local AI first.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stop('AI took too long. Try again with a shorter description or use the manual settings.'), timeout);
      this.pending.set(message.id, { resolve, reject, timer });
      this.worker!.postMessage(message);
    });
  }

  stop(reason = 'AI stopped.') {
    this.worker?.terminate(); this.worker = null;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error(reason)); }
    this.pending.clear(); this.onProgress = undefined;
  }
}
