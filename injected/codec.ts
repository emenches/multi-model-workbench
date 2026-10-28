// Module scope must stay side-effect-free (runs before subframe guard in the bundle).
//
// Why a document.title codec? Provider pages (ChatGPT/Claude/Gemini/Grok) enforce CSPs that block a
// localhost WebSocket and remote Tauri IPC from the injected script, so there is no normal outbound
// message channel from the page. `document.title` is the one narrow, allowed signal. This is a
// documented Tauri workaround (docs/ARCHITECTURE.md D3, docs/SPEC.md \u00A77) \u2014 NOT a covert channel:
//   - it carries ONLY status HINTS (STATUS_REPORT / "bulk-ready" wake-ups), never authoritative data;
//     the actual response payload is pulled via eval_with_callback (SPEC \u00A77.3), a normal Tauri IPC.
//   - the leading U+200B + "MAC1|" prefix and base64url exist for reliable, collision-free FRAMING
//     (so our frames aren't confused with the page's own title text), not for obfuscation.
//   - the Rust side (bridge.rs) drops any title it can't decode; this codec never reads cookies/storage.
export const TITLE_PREFIX = '\u200BMAC1|';
const TITLE_MAX_CHARS = 900;

export interface DecodedTitleFrame {
  bootId: string;
  seq: number;
  json: unknown;
}

export function base64UrlEncode(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? getTextEncoder().encode(value) : value;
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

export function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return getTextDecoder().decode(bytes);
}

export function encodeTitleFrame(bootId: string, seq: number, payload: unknown): string {
  const json = JSON.stringify(payload);
  const frame = `${TITLE_PREFIX}${bootId}|${seq}|${base64UrlEncode(json)}`;
  if (frame.length > TITLE_MAX_CHARS) {
    throw new Error(`title frame exceeds ${TITLE_MAX_CHARS} chars`);
  }
  return frame;
}

// The title channel is intentionally capped at 900 characters. Optional
// ChatGPT capture telemetry can exceed this during generation; never let an
// oversized status silence native readiness/heartbeat and done-ready hints.
// Full diagnostics remain available through the sanctioned read-only probe.
const COMPACT_STATUS_FIELDS = [
  'dom', 'login', 'thinking', 'bridge', 'adapter', 'reason',
  'bulkReady', 'doneReady', 'fill', 'fillChars', 'fillMs',
  'statusErrorStage', 'capturePhase',
  // Compact, text-free capture facts distinguish a missing embedded reply from
  // an over-strict candidate filter even while regular title reporting works.
  'captureResponseNodes', 'captureAssistantUnits',
  'captureLatestUnitDomChars', 'captureLatestUnitFrames',
  'captureDilRendererFrames', 'captureTextChars',
  'captureAnchor', 'captureGenerationSeen',
] as const;

export function encodeBoundedStatusTitleFrame<T extends { action: string; payload?: unknown }>(
  bootId: string,
  seq: number,
  message: T,
): { frame: string; compacted: boolean } {
  try {
    return { frame: encodeTitleFrame(bootId, seq, message), compacted: false };
  } catch (error) {
    // Fail loudly for encoding errors unrelated to overflow and for messages
    // that aren't status hints. A failed answer must never be silently dropped.
    if (message.action !== 'STATUS_REPORT' ||
        !(error instanceof Error) ||
        !/^title frame exceeds 900 chars$/.test(error.message)) throw error;

    const input = message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload)
      ? message.payload as Record<string, unknown>
      : {};
    const payload: Record<string, string | number | boolean | null> = {};
    for (const field of COMPACT_STATUS_FIELDS) {
      const value = input[field];
      if (typeof value === 'string') {
        payload[field] = value.slice(0, 48);
      } else if (typeof value === 'boolean') {
        payload[field] = value;
      } else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
        payload[field] = value;
      } else if (field === 'thinking' && value === null) {
        payload[field] = null;
      }
    }
    try {
      return {
        frame: encodeTitleFrame(bootId, seq, { ...message, payload }),
        compacted: true,
      };
    } catch (compactError) {
      if (!(compactError instanceof Error) ||
          !/^title frame exceeds 900 chars$/.test(compactError.message)) throw compactError;
      // The optional bounded fields together can still exceed the cap if
      // several strings are long. Keep a tiny, fixed safety/transport hint.
      // Never drop positive bulk/done signals or terminal status.
      const core: Record<string, string | number | boolean | null> = {};
      for (const field of ['dom', 'login', 'thinking', 'bridge', 'bulkReady', 'doneReady'] as const) {
        const value = payload[field];
        if (typeof value === 'string') core[field] = value.slice(0, 24);
        else if (typeof value === 'number' || typeof value === 'boolean' || value === null) core[field] = value;
      }
      return {
        frame: encodeTitleFrame(bootId, seq, { ...message, payload: core }),
        compacted: true,
      };
    }
  }
}

export function decodeTitleFrame(title: string): DecodedTitleFrame | null {
  if (!title.startsWith(TITLE_PREFIX)) return null;
  const parts = title.slice(TITLE_PREFIX.length).split('|');
  if (parts.length !== 3) throw new Error('invalid title frame field count');
  const [bootId, seqText, encoded] = parts;
  const seq = Number(seqText);
  if (!bootId || !Number.isSafeInteger(seq) || seq < 0) {
    throw new Error('invalid title frame identifiers');
  }
  return { bootId, seq, json: JSON.parse(base64UrlDecode(encoded)) };
}

function getTextEncoder(): TextEncoder {
  return new TextEncoder();
}

function getTextDecoder(): TextDecoder {
  return new TextDecoder();
}
