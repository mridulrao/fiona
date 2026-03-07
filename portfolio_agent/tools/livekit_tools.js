import { llm, getJobContext } from '@livekit/agents';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';

const MEMORY_API_BASE_URL = process.env.MEMORY_API_BASE_URL ?? 'http://127.0.0.1:8000';
const MEMORY_API_KEY_ID =
  process.env.MEMORY_API_KEY_ID ??
  process.env.API_KEY_ID ??
  process.env.WHATSAPP_BRIDGE_KEY_ID ??
  '';
const MEMORY_API_SECRET =
  process.env.MEMORY_API_SECRET ??
  process.env.API_SECRET ??
  process.env.WHATSAPP_BRIDGE_SECRET ??
  '';
const SHORT_LIVED_MEMORY_PIN = process.env.SHORT_LIVED_MEMORY_PIN ?? null;
const LK_TOOL_OBSERVABILITY = readBool('LK_TOOL_OBSERVABILITY', true);
const LK_TOOL_OBSERVABILITY_PUBLISH = readBool('LK_TOOL_OBSERVABILITY_PUBLISH', false);
const LK_DB_OBSERVABILITY_ENABLED = readBool('LK_DB_OBSERVABILITY_ENABLED', true);
const OBSERVABILITY_API_BASE_URL =
  process.env.OBSERVABILITY_API_BASE_URL ??
  process.env.WIDGET_SERVER_BASE_URL ??
  'http://localhost:3001';
const OBSERVABILITY_INGEST_KEY = process.env.OBSERVABILITY_INGEST_KEY ?? '';
const TOOL_OBS_MAX_ERROR_LEN = 300;
const WHATSAPP_BRIDGE_BASE_URL = process.env.WHATSAPP_BRIDGE_BASE_URL ?? 'http://localhost:3001';
const WHATSAPP_BRIDGE_KEY_ID = process.env.WHATSAPP_BRIDGE_KEY_ID ?? process.env.API_KEY_ID ?? '';
const WHATSAPP_BRIDGE_SECRET = process.env.WHATSAPP_BRIDGE_SECRET ?? process.env.API_SECRET ?? '';
const WHATSAPP_NOTIFY_RECIPIENT = process.env.WHATSAPP_NOTIFY_RECIPIENT ?? '';

let isShortLivedMemoryVerified = false;

function readBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizePin(pin) {
  return String(pin ?? '').trim();
}

function isValidPinFormat(pin) {
  return /^\d{4}$/.test(pin);
}

function summarizeValue(value) {
  if (value === null) return { type: 'null' };
  if (value === undefined) return { type: 'undefined' };
  if (typeof value === 'string') return { type: 'string', length: value.length };
  if (typeof value === 'number') return { type: 'number', finite: Number.isFinite(value) };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  if (typeof value === 'object') return { type: 'object', keys: Object.keys(value).length };
  return { type: typeof value };
}

function summarizeRecord(record) {
  if (!record || typeof record !== 'object') {
    return { type: typeof record };
  }
  const summary = {};
  for (const [key, value] of Object.entries(record)) {
    summary[key] = summarizeValue(value);
  }
  return summary;
}

function summarizeToolResult(result) {
  if (!result || typeof result !== 'object') {
    return summarizeValue(result);
  }

  const summary = summarizeRecord(result);
  if ('success' in result) summary.success = Boolean(result.success);
  if ('verified' in result) summary.verified = Boolean(result.verified);
  if ('cancelled' in result) summary.cancelled = Boolean(result.cancelled);
  if ('requestId' in result) summary.hasRequestId = Boolean(result.requestId);
  if ('error' in result) {
    const errorText = String(result.error ?? '');
    summary.error = errorText.slice(0, TOOL_OBS_MAX_ERROR_LEN);
  }
  return summary;
}

async function emitToolTelemetry(event) {
  if (!LK_TOOL_OBSERVABILITY) return;

  console.log('[tool-observability]', JSON.stringify(event));
  let sessionId = null;
  let roomName = null;
  try {
    const jobCtx = getJobContext();
    sessionId = jobCtx?.job?.id ? String(jobCtx.job.id) : null;
    roomName = jobCtx?.room?.name ? String(jobCtx.room.name) : null;
  } catch {}

  if (LK_DB_OBSERVABILITY_ENABLED) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (OBSERVABILITY_INGEST_KEY) {
        headers['x-observability-key'] = OBSERVABILITY_INGEST_KEY;
      }
      await fetch(`${OBSERVABILITY_API_BASE_URL}/observability/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          source: 'tool',
          eventType: event.phase === 'api_call' ? 'tool_api_call' : 'tool_execution',
          toolName: typeof event.tool === 'string' ? event.tool : null,
          status: event.status ?? null,
          durationMs: Number.isFinite(event.durationMs) ? event.durationMs : null,
          sessionId,
          roomName,
          payload: event,
        }),
      });
    } catch (error) {
      console.warn(
        '[tool-observability] failed to persist telemetry:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (!LK_TOOL_OBSERVABILITY_PUBLISH) return;

  try {
    const jobCtx = getJobContext();
    if (!jobCtx?.room?.localParticipant) return;
    const payload = JSON.stringify({
      type: 'TOOL_OBSERVABILITY',
      ts: Date.now(),
      ...event,
    });
    await jobCtx.room.localParticipant.publishData(new TextEncoder().encode(payload), { reliable: true });
  } catch (error) {
    console.warn(
      '[tool-observability] failed to publish telemetry:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

function withToolObservability(toolName, execute) {
  return async (args, context) => {
    const startedAt = Date.now();
    await emitToolTelemetry({
      phase: 'start',
      tool: toolName,
      args: summarizeRecord(args),
    });

    try {
      const result = await execute(args, context);
      const durationMs = Date.now() - startedAt;
      await emitToolTelemetry({
        phase: 'end',
        status: 'success',
        tool: toolName,
        durationMs,
        result: summarizeToolResult(result),
      });
      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      await emitToolTelemetry({
        phase: 'end',
        status: 'error',
        tool: toolName,
        durationMs,
        error: message.slice(0, TOOL_OBS_MAX_ERROR_LEN),
      });
      throw error;
    }
  };
}

function buildLeadNotificationText(values) {
  const name = values?.name || 'Unknown';
  const contact = values?.contact || 'Not provided';
  const userMessage = values?.message || 'Not provided';
  const timestamp = new Date().toISOString();
  return [
    'Hey, Yuki this side. Someone tried to connect you - ',
    `Name: ${name}`,
    `Contact: ${contact}`,
    `Message: ${userMessage}`,
    `Received at: ${timestamp}`,
  ].join('\n');
}

async function notifyWhatsAppLead(values) {
  if (!WHATSAPP_NOTIFY_RECIPIENT) {
    return { attempted: false, sent: false, reason: 'WHATSAPP_NOTIFY_RECIPIENT is not configured' };
  }
  if (!WHATSAPP_BRIDGE_KEY_ID || !WHATSAPP_BRIDGE_SECRET) {
    return { attempted: false, sent: false, reason: 'WhatsApp bridge auth keys are not configured' };
  }

  const url = new URL('/send-message', WHATSAPP_BRIDGE_BASE_URL);
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = typeof randomUUID === 'function' ? randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const body = JSON.stringify({
    recipient: WHATSAPP_NOTIFY_RECIPIENT,
    message: buildLeadNotificationText(values),
  });
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const payloadToSign = `POST\n${url.pathname}\n${ts}\n${nonce}\n${bodyHash}`;
  const signature = createHmac('sha256', WHATSAPP_BRIDGE_SECRET).update(payloadToSign).digest('hex');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Key-Id': WHATSAPP_BRIDGE_KEY_ID,
        'X-Timestamp': ts,
        'X-Nonce': nonce,
        'X-Signature': signature,
      },
      body,
    });

    if (!response.ok) {
      const raw = await response.text();
      return {
        attempted: true,
        sent: false,
        status: response.status,
        error: `Bridge rejected notification: ${raw || response.statusText}`,
      };
    }

    return { attempted: true, sent: true };
  } catch (error) {
    return {
      attempted: true,
      sent: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function postJson(path, body) {
  const startedAt = Date.now();
  if (!MEMORY_API_KEY_ID || !MEMORY_API_SECRET) {
    throw new Error('Memory API auth is not configured. Set MEMORY_API_KEY_ID and MEMORY_API_SECRET.');
  }

  const url = new URL(path, MEMORY_API_BASE_URL);
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = typeof randomUUID === 'function' ? randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const payload = JSON.stringify(body);
  const bodyHash = createHash('sha256').update(payload).digest('hex');
  const payloadToSign = `POST\n${url.pathname}\n${ts}\n${nonce}\n${bodyHash}`;
  const signature = createHmac('sha256', MEMORY_API_SECRET).update(payloadToSign).digest('hex');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Key-Id': MEMORY_API_KEY_ID,
      'X-Timestamp': ts,
      'X-Nonce': nonce,
      'X-Signature': signature,
    },
    body: payload,
  });

  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }

  if (!response.ok) {
    await emitToolTelemetry({
      phase: 'api_call',
      status: 'error',
      api: path,
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
    });
    throw new Error(
      `Memory API request failed (${response.status} ${response.statusText}) at ${path}: ${raw || 'No response body'}`
    );
  }

  await emitToolTelemetry({
    phase: 'api_call',
    status: 'success',
    api: path,
    httpStatus: response.status,
    durationMs: Date.now() - startedAt,
  });

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
  execute: withToolObservability('getUserInput', async (_args, { ctx }) => {
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

    const values = {
      name:    (res.values?.name    ?? '').trim(),
      contact: (res.values?.contact ?? '').trim(),
      message: (res.values?.message ?? '').trim(),
    };
    const leadNotification = await notifyWhatsAppLead(values);
    if (leadNotification.attempted && !leadNotification.sent) {
      console.warn(
        '[getUserInput] failed to send WhatsApp lead notification:',
        leadNotification.error ?? leadNotification.reason ?? 'unknown',
      );
    }

    return {
      success: true,
      cancelled: false,
      requestId,
      values,
      leadNotification,
    };
  }),
});

export const verifyShortLivedMemoryPin = llm.tool({
  name: 'verifyShortLivedMemoryPin',
  description:
    'Verify caller for privileged short-lived memory writes using a 4-digit PIN code from environment configuration.',
  parameters: z.object({
    pin_code: z.string().regex(/^\d{4}$/, 'pin_code must be exactly 4 digits'),
  }),
  execute: withToolObservability('verifyShortLivedMemoryPin', async (args) => {
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
  }),
});

export const storeShortLivedMemory = llm.tool({
  name: 'storeShortLivedMemory',
  description:
    'Store a short-lived status update or note about Mridul. Use for daily updates, active notices, or temporary context that may expire.',
  parameters: z.object({
    content: z.string().min(1).max(1000),
    when_to_use: z.string().max(500).default(''),
    score: z.number().min(0).max(1).optional(),
    ttl_hours: z.number().int().min(0).max(24 * 365).default(24),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  execute: withToolObservability('storeShortLivedMemory', async (args) => {
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
        score: args.score ?? 0.7,
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
  }),
});

export const queryShortLivedMemory = llm.tool({
  name: 'queryShortLivedMemory',
  description:
    'Retrieve short-lived notes about Mridul that are relevant to the current question (for current status, active notices, or latest updates).',
  parameters: z.object({
    query: z.string().min(1).max(500),
    top_k: z.number().int().min(1).max(100).default(10),
    vector_weight: z.number().min(0).max(1).default(0.7),
    include_expired: z.boolean().default(false),
  }),
  execute: withToolObservability('queryShortLivedMemory', async (args) => {
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
  }),
});
