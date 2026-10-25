import type { PrintOptions } from '@/lib/print-options'
import { useAppStore } from '@/store'

/** Reads one print option and returns a setter for it, like useState but backed by the store. */
export function useOption<K extends keyof PrintOptions>(key: K) {
  const value = useAppStore((state) => state.options[key])
  const setOption = useAppStore((state) => state.setOption)
  return [value, (next: PrintOptions[K]) => setOption(key, next)] as const
}
