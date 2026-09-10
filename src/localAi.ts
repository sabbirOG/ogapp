import { CreateMLCEngine } from '@mlc-ai/web-llm'
import type { MLCEngine } from '@mlc-ai/web-llm'

export const LOCAL_MODEL = 'Qwen3-4B-q4f16_1-MLC'

let enginePromise: Promise<MLCEngine> | null = null

export async function loadLocalAi(onProgress: (message: string) => void) {
  if (!('gpu' in navigator)) throw new Error('This device does not support WebGPU.')
  enginePromise ??= CreateMLCEngine(LOCAL_MODEL, {
    initProgressCallback: (progress) => onProgress(progress.text),
  })
  return enginePromise
}

export async function askLocalAi(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  onProgress: (message: string) => void,
) {
  const engine = await loadLocalAi(onProgress)
  const response = await engine.chat.completions.create({ messages })
  return response.choices[0]?.message.content || 'I could not form a response. Please try again.'
}
