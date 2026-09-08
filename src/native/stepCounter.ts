import { registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'

export type StepCounterStatus = {
  available: boolean
  authorized: boolean
  steps: number
  date: string
  goal: number
  tracking: boolean
}

export interface StepCounterPlugin {
  getStatus(): Promise<StepCounterStatus>
  requestPermission(): Promise<{ granted: boolean }>
  startTracking(options?: { goal?: number }): Promise<StepCounterStatus>
  stopTracking(): Promise<void>
  addListener(eventName: 'stepsChanged', listenerFunc: (status: StepCounterStatus) => void): Promise<PluginListenerHandle>
}

export const StepCounter = registerPlugin<StepCounterPlugin>('StepCounter', {
  web: () => ({
    getStatus: async () => ({ available: false, authorized: false, steps: 0, date: '', goal: 10000, tracking: false }),
    requestPermission: async () => ({ granted: false }),
    startTracking: async () => ({ available: false, authorized: false, steps: 0, date: '', goal: 10000, tracking: false }),
    stopTracking: async () => undefined,
    addListener: async () => ({ remove: async () => undefined }),
  }),
})
