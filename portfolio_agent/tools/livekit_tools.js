import { llm, getJobContext } from '@livekit/agents';
import { z } from 'zod';

const MEMORY_API_BASE_URL = process.env.MEMORY_API_BASE_URL ?? 'http://127.0.0.1:8000';
const SHORT_LIVED_MEMORY_PIN = process.env.SHORT_LIVED_MEMORY_PIN ?? null;

let isShortLivedMemoryVerified = false;

function normalizePin(pin) {
  return String(pin ?? '').trim();
}

function isValidPinFormat(pin) {
  return /^\d{4}$/.test(pin);
}

async function postJson(path, body) {
  const response = await fetch(`${MEMORY_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : null;

  if (!response.ok) {
    throw new Error(
      `Memory API request failed (${response.status} ${response.statusText}) at ${path}: ${raw || 'No response body'}`
    );
  }

  return data;
}

export async function sendWidget(ctx, widget, payload = {}) {  
  const jobCtx = getJobContext(); // Get JobContext instead of using RunContext  
  const msg = JSON.stringify({ type: 'YUKI_WIDGET', widget, ts: Date.now(), ...payload });  
  await jobCtx.room.localParticipant.publishData(new TextEncoder().encode(msg), { reliable: true });  
}

function waitForUiResponse(ctx, opts) {  
  const { requestId, fromIdentity, timeoutMs = 120_000 } = opts;  
  const jobCtx = getJobContext(); // Get JobContext for room access  
  
  return new Promise((resolve, reject) => {  
    const timer = setTimeout(() => {  
      cleanup();  
      reject(new Error('User input timed out'));  
    }, timeoutMs);  
  
    const cleanup = () => {  
      clearTimeout(timer);  
      try { jobCtx.room.off('dataReceived', onDataReceived); } catch {}  
    };  
  
    const onDataReceived = (payload, participant) => {  
      try {  
        if (fromIdentity && participant?.identity !== fromIdentity) return;  
  
        const text = new TextDecoder().decode(payload);  
        const msg = JSON.parse(text);  
        if (!msg || msg.requestId !== requestId) return;  
  
        if (msg.type === 'YUKI_GETUSERINPUT_RESULT') {  
          cleanup();  
          resolve({ values: msg.values || {}, cancelled: false });  
          return;  
        }  
  
        if (msg.type === 'YUKI_GETUSERINPUT_CANCEL') {  
          cleanup();  
          resolve({ values: {}, cancelled: true });  
          return;  
        }  
      } catch {  
        // ignore malformed messages  
      }  
    };  
  
    jobCtx.room.on('dataReceived', onDataReceived);  
  });  
}

export const getUserInput = llm.tool({
  name: 'getUserInput',
  description: 'Show the user a form to collect their details. Call this when you need the user\'s details.',
  parameters: z.object({}), // ← no params; form fields are owned by the UI widget
  execute: async (_args, { ctx }) => {
    const requestId =
      (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

    await sendWidget(ctx, 'getuserinput', {
      requestId,
      identity: null,
      title: null,
      prompt: null,
    });

    const res = await waitForUiResponse(ctx, {
      requestId,
      fromIdentity: undefined,
      timeoutMs: 120_000,
    });

    if (res.cancelled) {
      return { success: false, cancelled: true, values: {}, requestId };
    }

    return {
      success: true,
      cancelled: false,
      requestId,
      values: {
        name:    (res.values?.name    ?? '').trim(),
        contact: (res.values?.contact ?? '').trim(),
        message: (res.values?.message ?? '').trim(),
      },
    };
  },
});

export const verifyShortLivedMemoryPin = llm.tool({
  name: 'verifyShortLivedMemoryPin',
  description:
    'Verify caller for privileged short-lived memory writes using a 4-digit PIN code from environment configuration.',
  parameters: z.object({
    pin_code: z.string().regex(/^\d{4}$/, 'pin_code must be exactly 4 digits'),
  }),
  execute: async (args) => {
    const providedPin = normalizePin(args.pin_code);

    if (!SHORT_LIVED_MEMORY_PIN) {
      isShortLivedMemoryVerified = false;
      return {
        success: false,
        verified: false,
        error: 'SHORT_LIVED_MEMORY_PIN (or MEMORY_PIN) is not configured',
      };
    }

    if (!isValidPinFormat(SHORT_LIVED_MEMORY_PIN)) {
      isShortLivedMemoryVerified = false;
      return {
        success: false,
        verified: false,
        error: 'Configured PIN format is invalid; expected exactly 4 digits',
      };
    }

    if (providedPin !== SHORT_LIVED_MEMORY_PIN) {
      isShortLivedMemoryVerified = false;
      return {
        success: false,
        verified: false,
        error: 'PIN verification failed',
      };
    }

    isShortLivedMemoryVerified = true;
    return {
      success: true,
      verified: true,
    };
  },
});

export const storeShortLivedMemory = llm.tool({
  name: 'storeShortLivedMemory',
  description:
    'Store a short-lived status update or note about Mridul. Use for daily updates, active notices, or temporary context that may expire.',
  parameters: z.object({
    content: z.string().min(1).max(1000),
    when_to_use: z.string().min(1).max(500),
    score: z.number().min(0).max(1).optional(),
    ttl_hours: z.number().int().min(1).max(168).default(24),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  execute: async (args) => {
    if (!SHORT_LIVED_MEMORY_PIN) {
      return {
        success: false,
        baseUrl: MEMORY_API_BASE_URL,
        error: 'SHORT_LIVED_MEMORY_PIN (or MEMORY_PIN) is not configured',
      };
    }

    if (!isShortLivedMemoryVerified) {
      return {
        success: false,
        baseUrl: MEMORY_API_BASE_URL,
        error: 'Not authorized to store short-lived memory. Verify with verifyShortLivedMemoryPin first.',
      };
    }

    try {
      const result = await postJson('/memories/short-lived', {
        content: args.content,
        when_to_use: args.when_to_use,
        score: args.score ?? 0.75,
        ttl_hours: args.ttl_hours,
        metadata: args.metadata ?? {},
      });

      return {
        success: true,
        baseUrl: MEMORY_API_BASE_URL,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        baseUrl: MEMORY_API_BASE_URL,
        error: error instanceof Error ? error.message : 'Unknown error while storing short-lived memory',
      };
    }
  },
});

export const queryShortLivedMemory = llm.tool({
  name: 'queryShortLivedMemory',
  description:
    'Retrieve short-lived notes about Mridul that are relevant to the current question (for current status, active notices, or latest updates).',
  parameters: z.object({
    query: z.string().min(1).max(500),
    top_k: z.number().int().min(1).max(20).default(5),
    vector_weight: z.number().min(0).max(1).default(0.7),
    include_expired: z.boolean().default(false),
  }),
  execute: async (args) => {
    try {
      const result = await postJson('/memories/short-lived/query', {
        query: args.query,
        top_k: args.top_k,
        vector_weight: args.vector_weight,
        include_expired: args.include_expired,
      });

      return {
        success: true,
        baseUrl: MEMORY_API_BASE_URL,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        baseUrl: MEMORY_API_BASE_URL,
        error: error instanceof Error ? error.message : 'Unknown error while retrieving short-lived memories',
      };
    }
  },
});
