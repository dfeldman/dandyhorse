// Small guards around Web Bluetooth so the app never crashes where it is unavailable.

export function bluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth
}

export function bluetoothUnavailableReason(): string | null {
  if (bluetoothAvailable()) return null
  if (typeof window !== 'undefined' && !window.isSecureContext) return 'Web Bluetooth needs a secure context (HTTPS or localhost).'
  return 'Web Bluetooth not available in this browser (use Chrome/Edge on desktop or Android; Bluefy on iOS).'
}

export function requireBluetooth(): Bluetooth {
  const reason = bluetoothUnavailableReason()
  if (reason) throw new Error(reason)
  return navigator.bluetooth
}

/** Previously granted devices, when the browser supports getDevices(). */
export async function knownDevices(): Promise<BluetoothDevice[]> {
  if (!bluetoothAvailable()) return []
  const bt = navigator.bluetooth as Bluetooth & { getDevices?: () => Promise<BluetoothDevice[]> }
  if (typeof bt.getDevices !== 'function') return []
  try { return await bt.getDevices() } catch { return [] }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
