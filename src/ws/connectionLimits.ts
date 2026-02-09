/**
 * Tracks WebSocket connection counts per IP and total for rate limiting.
 */
export interface ConnectionLimitsConfig {
  maxPerIp: number;
  maxTotal: number;
}

export function createConnectionLimits(config: ConnectionLimitsConfig): {
  tryAcquire: (clientIp: string) => boolean;
  release: (clientIp: string) => void;
  getTotal: () => number;
} {
  const ipCount = new Map<string, number>();
  let total = 0;
  const { maxPerIp, maxTotal } = config;

  function tryAcquire(clientIp: string): boolean {
    if (maxTotal > 0 && total >= maxTotal) return false;
    const perIp = (ipCount.get(clientIp) ?? 0) + 1;
    if (maxPerIp > 0 && perIp > maxPerIp) return false;
    ipCount.set(clientIp, perIp);
    total += 1;
    return true;
  }

  function release(clientIp: string): void {
    const n = ipCount.get(clientIp) ?? 0;
    if (n <= 1) {
      ipCount.delete(clientIp);
    } else {
      ipCount.set(clientIp, n - 1);
    }
    if (total > 0) total -= 1;
  }

  function getTotal(): number {
    return total;
  }

  return { tryAcquire, release, getTotal };
}
