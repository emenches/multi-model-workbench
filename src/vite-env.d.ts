/// <reference types="vite/client" />

import type { BridgeMessage } from '../shared/types';

declare global {
  interface Window {
    __MAC_PROVIDER__?: string;
    __MAC_APP_HOSTS__?: string[];
    __MAC_BRIDGE__?: {
      version: 1;
      bootId: string;
      emit(message: unknown): void;
      dispatch(message: BridgeMessage): void;
      onDispatch(handler: (message: BridgeMessage) => void): void;
      emitTitle(action: string, payload?: unknown, options?: { immediate?: boolean }): void;
      enqueueBulk(message: unknown): unknown;
      peekOutbox(): BridgeMessage[];
      ackBulk(maxMid: number): void;
      sendBulk(action: string, payload?: unknown): Promise<void>;
    };
    __MAC_ENGINE__?: {
      bootId: string;
      adapterVersion: number;
      statusTicks: number;
      responsePollTicks: number;
      waitingForResponse: boolean;
      statusEmits: number;
      fillStarts: number;
      fillDones: number;
      capturePhase: string | null;
      captureResponseNodes: number;
      captureAssistantUnits: number;
      captureLatestUnitDomChars: number;
      captureTextChars: number;
      captureAnchor: boolean;
      captureGenerationSeen: boolean;
      stop?: () => void;
    };
  }
}
