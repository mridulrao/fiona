import { llm, getJobContext } from '@livekit/agents';
import { z } from 'zod';

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