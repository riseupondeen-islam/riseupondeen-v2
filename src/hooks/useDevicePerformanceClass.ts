import { useEffect } from 'react';

/** body.perf-lite: lighter visuals on touch, narrow, low-memory or low-core devices (same budget as before). */
export function useDevicePerformanceClass(): void {
  useEffect(() => {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const coarse = matchMedia('(pointer:coarse)').matches;
    const narrow = matchMedia('(max-width:980px)').matches;
    const lowMemory = !!nav.deviceMemory && nav.deviceMemory <= 4;
    const lowCpu = !!navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
    if (coarse || narrow || lowMemory || lowCpu) document.body.classList.add('perf-lite');
  }, []);
}
