/// <reference lib="webworker" />
import { CreateMLCEngine } from '@mlc-ai/web-llm';
import type { MLCEngineInterface } from '@mlc-ai/web-llm';
import { AI_MODEL_F16, AI_MODEL_F32, aiSchema, aiSystemPrompt, checkAiExtraction, validateAiPrompt } from '../lib/ai-experiment';
import type { AiWorkerRequest, AiWorkerResponse } from '../lib/ai-experiment';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let engine: MLCEngineInterface | null = null;
let busy = false;
const send = (message: AiWorkerResponse) => scope.postMessage(message);

scope.onmessage = async ({ data }: MessageEvent<AiWorkerRequest>) => {
  if (busy) { send({ id: data.id, type: 'error', message: 'AI is already working. Please wait or cancel.' }); return; }
  busy = true;
  try {
    if (data.type === 'load') {
      if (![AI_MODEL_F16, AI_MODEL_F32].includes(data.model)) throw new Error('Unsupported model.');
      if (engine) await engine.unload();
      engine = await CreateMLCEngine(data.model, {
        initProgressCallback: report => send({ id: data.id, type: 'progress', progress: report.progress, text: report.text }),
        logLevel: 'ERROR',
      }, { context_window_size: 2048 });
      send({ id: data.id, type: 'loaded' });
    } else if (data.type === 'extract') {
      if (!engine) throw new Error('Enable local AI first.');
      const prompt = validateAiPrompt(data.prompt);
      const reply = await engine.chat.completions.create({
        messages: [{ role: 'system', content: aiSystemPrompt }, { role: 'user', content: prompt }],
        response_format: { type: 'json_object', schema: JSON.stringify(aiSchema) },
        temperature: 0,
        max_tokens: 768,
        stream: false,
      });
      const choice = reply.choices[0];
      if (choice?.finish_reason === 'length') throw new Error('The response was incomplete. Shorten the description and try again.');
      send({ id: data.id, type: 'result', text: checkAiExtraction(choice?.message.content ?? '', prompt) });
    }
  } catch (error) {
    send({ id: data.id, type: 'error', message: error instanceof Error ? error.message : 'Browser AI could not complete the request.' });
  } finally { busy = false; }
};
