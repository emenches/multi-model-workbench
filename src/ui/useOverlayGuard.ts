import { useEffect, useRef } from 'react';
import type { AIProvider } from '../../shared/types';
import { host } from '../host';
import { globalOverlayGuard } from './overlayGuard';

export function useOverlayGuard(
  open: boolean,
  loadedProviders: AIProvider[],
  safeRestore: (provider: AIProvider) => Promise<void>,
): void {
  // A provider child WebView must never be shown just because a modal closed.
  // Only the caller knows whether it is actually the visible native center and
  // which measured bounds it belongs in.
  const restoreRef = useRef(safeRestore);
  restoreRef.current = safeRestore;
  const loadedProvidersRef = useRef(loadedProviders);
  const loadedProvidersKey = loadedProviders.join('|');
  loadedProvidersRef.current = loadedProviders;

  useEffect(() => {
    if (!open) return;
    globalOverlayGuard.open(loadedProvidersRef.current, {
      hide: host.provider.hide,
      show: host.provider.show,
    });
    return () => {
      globalOverlayGuard.close(
        {
          hide: host.provider.hide,
          show: (provider) => restoreRef.current(provider),
        },
        loadedProvidersRef.current,
      );
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    globalOverlayGuard.reconcile(loadedProvidersRef.current, {
      hide: host.provider.hide,
      show: host.provider.show,
    });
  }, [open, loadedProvidersKey]);
}
