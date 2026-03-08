import { defineAgent, JobContext, WorkerOptions, voice, metrics } from '@livekit/agents';  
import * as deepgram from '@livekit/agents-plugin-deepgram';  
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';  
import * as livekit from '@livekit/agents-plugin-livekit';
import * as openai from '@livekit/agents-plugin-openai';  
import * as silero from '@livekit/agents-plugin-silero';  
import { BackgroundVoiceCancellation } from '@livekit/noise-cancellation-node';  
import dotenv from 'dotenv';  
import { fileURLToPath } from 'node:url';  
import { cli } from '@livekit/agents';  
  
import { INSTRUCTIONS } from '../instructions/prompt.js';  
import { handleUserInput, clearChatHistory } from '../agents/background_agent.js';
import { getUserInput, verifyShortLivedMemoryPin, storeShortLivedMemory, queryShortLivedMemory } from '../tools/livekit_tools.js'; 
import { BackchannelController } from './backchannel.js';

dotenv.config({ path: '.env.local' });  

type WorkerUserData = {
  vad?: silero.VAD;
};

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function formatUsageSummary(summary: metrics.UsageSummary): string {
  const sttAudioSeconds = Math.round(summary.sttAudioDurationMs / 10) / 100;
  return [
    `llmPromptTokens=${summary.llmPromptTokens}`,
    `llmPromptCachedTokens=${summary.llmPromptCachedTokens}`,
    `llmCompletionTokens=${summary.llmCompletionTokens}`,
    `ttsCharacters=${summary.ttsCharactersCount}`,
    `sttAudioSeconds=${sttAudioSeconds}`,
  ].join(' ');
}

const OBSERVABILITY_API_BASE_URL =
  process.env.OBSERVABILITY_API_BASE_URL ??
  process.env.WIDGET_SERVER_BASE_URL ??
  'http://localhost:3001';
const OBSERVABILITY_INGEST_KEY = process.env.OBSERVABILITY_INGEST_KEY ?? '';
const LK_DB_OBSERVABILITY_ENABLED = readBool('LK_DB_OBSERVABILITY_ENABLED', true);

async function emitDbObservabilityEvent(event: Record<string, unknown>): Promise<void> {
  if (!LK_DB_OBSERVABILITY_ENABLED) return;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (OBSERVABILITY_INGEST_KEY) {
      headers['x-observability-key'] = OBSERVABILITY_INGEST_KEY;
    }

    await fetch(`${OBSERVABILITY_API_BASE_URL}/observability/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
    });
  } catch (error) {
    console.warn(
      '[observability-db] failed to emit agent event:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function loadTurnDetectionModel(): Promise<unknown> {
  try {
    const model = new livekit.turnDetector.MultilingualModel();
    await model.supportsLanguage('en');
    return model;
  } catch (error) {
    console.warn(
      'Turn detector unavailable or model assets missing. Falling back to turnDetection="stt". Run `pnpm run download-files` with internet access to enable model-based endpointing.',
      error,
    );
    return 'stt';
  }
}
  
// Validate required environment variables  
const requiredEnvVars = ['GROQ_API_KEY', 'DEEPGRAM_API_KEY', 'ELEVEN_API_KEY'];  
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);  
  
if (missingVars.length > 0) {  
  console.error('Missing required environment variables:', missingVars.join(', '));  
  process.exit(1);  
}  
  
class Assistant extends voice.Agent {  
  constructor() {  
    super({  
      instructions: INSTRUCTIONS,  
      tools: {
        getUserInput,
        verifyShortLivedMemoryPin,
        storeShortLivedMemory,
        queryShortLivedMemory,
      }
    });  
  }  
}  
  
export default defineAgent({  
  prewarm: async (proc) => {  
    try {  
      const vad = await silero.VAD.load();
      const userData = proc.userData as WorkerUserData;
      userData.vad = vad;
    } catch (error) {  
      console.error('Failed to load VAD:', error);  
      throw error;  
    }  
  },  
  entry: async (ctx: JobContext) => {    
  
    let session: voice.AgentSession;
    let backchannel: BackchannelController | undefined;
    const sttEndpointingMs = readPositiveInt('DEEPGRAM_ENDPOINTING_MS', 700);
    const sttNoDelay = readBool('DEEPGRAM_NO_DELAY', false);
    const minEndpointingDelayMs = readPositiveInt('LK_MIN_ENDPOINTING_DELAY_MS', 1400);
    const maxEndpointingDelayMs = readPositiveInt('LK_MAX_ENDPOINTING_DELAY_MS', 6000);
    const backchannelAllowInterruptions = readBool('BACKCHANNEL_ALLOW_INTERRUPTION', false);
    const recordInsights = readBool('LK_AGENT_RECORD', true);
    const logSdkMetrics = readBool('LK_LOG_SDK_METRICS', true);
    const usageCollector = new metrics.UsageCollector();
    const sessionStartedAt = Date.now();
    const sessionId = String((ctx as any)?.job?.id ?? `${ctx.room.name}_${sessionStartedAt}`);
    const roomName = String(ctx.room.name ?? 'unknown_room');
  
    try {  
      const stt = new deepgram.STT({
        model: "nova-3",
        language: "en-IN",
        detectLanguage: false,

        interimResults: true,
        punctuate: true,
        smartFormat: true,
        numerals: true,
        profanityFilter: false,
        fillerWords: false,

        noDelay: sttNoDelay,
        endpointing: sttEndpointingMs,
        dictation: false,
        diarize: false,

        sampleRate: 16000,
        numChannels: 1,

        //keywords: [["Mridul", 2.0]],
        keyterm: ["Mridul", "Yuki"],
        mipOptOut: false,
      });   
      const llm = new openai.LLM({  
        //baseURL: 'https://api.groq.com/openai/v1',  
        //apiKey: process.env.GROQ_API_KEY,  
        model: 'gpt-5.1-2025-11-13',  
      });   
      const tts = new elevenlabs.TTS({  
        voiceId: "54Cze5LrTSyLgbO6Fhlc",  
        model: "eleven_flash_v2_5" ,
        voiceSettings: {
          stability: 0.5,
          similarity_boost: 0.55,
          style: 0.3,
          speed: 1.1,
          use_speaker_boost: true,
        }, 
      });  

      await ctx.connect();

      const turnDetection = await loadTurnDetectionModel();
      console.log(
        `Turn detection mode: ${typeof turnDetection === 'string' ? turnDetection : 'model'} | STT endpointing=${sttEndpointingMs}ms | noDelay=${sttNoDelay} | endpoint window=${minEndpointingDelayMs}-${maxEndpointingDelayMs}ms | backchannelInterruptible=${backchannelAllowInterruptions} | insightsRecord=${recordInsights} | logSdkMetrics=${logSdkMetrics}`,
      );

      session = new voice.AgentSession({  
        vad: (ctx.proc.userData as WorkerUserData).vad! as silero.VAD,
        turnDetection: turnDetection as any,
        stt,  
        llm,  
        tts,  
        voiceOptions: {
          // Keep a short lower bound for responsiveness; turn detector can extend to max when continuation is likely.
          minEndpointingDelay: minEndpointingDelayMs,
          maxEndpointingDelay: maxEndpointingDelayMs,
          discardAudioIfUninterruptible: false,
          allowInterruptions: true,
          minInterruptionDuration: 120,
          minInterruptionWords: 0
        },
      });  

      await session.start({  
        agent: new Assistant(),  
        room: ctx.room,  
        inputOptions: {  
          noiseCancellation: BackgroundVoiceCancellation(),  
        },  
        record: recordInsights,
      });    

      void emitDbObservabilityEvent({
        source: 'agent',
        eventType: 'session_started',
        status: 'success',
        sessionId,
        roomName,
        payload: {
          turnDetectionMode: typeof turnDetection === 'string' ? turnDetection : 'model',
          sttEndpointingMs,
          sttNoDelay,
          minEndpointingDelayMs,
          maxEndpointingDelayMs,
          recordInsights,
          logSdkMetrics,
        },
      });

      session.on(voice.AgentSessionEventTypes.MetricsCollected, (event: any) => {
        usageCollector.collect(event.metrics);
        if (logSdkMetrics) {
          metrics.logMetrics(event.metrics);
        }
        void emitDbObservabilityEvent({
          source: 'agent',
          eventType: 'metrics_collected',
          sessionId,
          roomName,
          payload: {
            metricType: event?.metrics?.type ?? 'unknown',
            metrics: event?.metrics ?? {},
          },
        });
      });

      session.on(voice.AgentSessionEventTypes.FunctionToolsExecuted, (event: any) => {
        const callNames = Array.isArray(event.functionCalls)
          ? event.functionCalls.map((call: any) => call?.name).filter(Boolean)
          : [];
        console.log(
          `Tool execution batch count=${callNames.length} names=${callNames.join(',') || 'none'}`,
        );
        void emitDbObservabilityEvent({
          source: 'agent',
          eventType: 'function_tools_executed',
          sessionId,
          roomName,
          payload: {
            count: callNames.length,
            names: callNames,
          },
        });
      });

      session.on(voice.AgentSessionEventTypes.Error, (event: any) => {
        console.error('Agent session error event:', event.error);
        void emitDbObservabilityEvent({
          source: 'agent',
          eventType: 'session_error',
          status: 'error',
          sessionId,
          roomName,
          payload: {
            error: event?.error instanceof Error ? event.error.message : String(event?.error ?? 'Unknown error'),
          },
        });
      });

      session.on(voice.AgentSessionEventTypes.Close, (event: any) => {
        const sessionDurationMs = Date.now() - sessionStartedAt;
        const summary = usageCollector.getSummary();
        console.log(
          `Agent session closed reason=${event.reason} durationMs=${sessionDurationMs} ${formatUsageSummary(summary)}`,
        );
        void emitDbObservabilityEvent({
          source: 'agent',
          eventType: 'session_closed',
          status: event?.reason === 'error' ? 'error' : 'success',
          sessionId,
          roomName,
          durationMs: sessionDurationMs,
          payload: {
            reason: event?.reason ?? 'unknown',
            usageSummary: summary,
          },
        });
      });

      backchannel = new BackchannelController({
        say: (text: string) =>
          session.say(text, {
            allowInterruptions: backchannelAllowInterruptions,
            addToChatCtx: false,
          }),
        logger: (message: string) => console.log(message),
      });

      // ── User transcript ──────────────────────────────────────────────
      session.on(voice.AgentSessionEventTypes.UserInputTranscribed, async (event: any) => {  
        backchannel?.onTranscript(event);

        if (event.isFinal) {  
          const text = event.transcript;  
          console.log('User:', text);  
          await handleUserInput(text);  
          if (text && ctx.room.localParticipant) {  
            ctx.room.localParticipant.publishData(  
              Buffer.from(JSON.stringify({ type: 'TRANSCRIPT', role: 'user', text })),  
              { reliable: true }  
            );  
          }  
        }  
      });

      // ── Agent transcript ─────────────────────────────────────────────
      session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (event: any) => {
        if (event.item.type === 'message') {
          const text: string = event.item.content;
          console.log('Agent:', text);
          if (text && ctx.room.localParticipant) {
            ctx.room.localParticipant.publishData(
              Buffer.from(JSON.stringify({ type: 'TRANSCRIPT', role: 'assistant', text })),
              { reliable: true }
            );
          }
        }
      });
      
      await session.say('Hi, this is Yuki. How can I help you today?');
   
    } catch (error) {  
      console.error('Error in agent entry:', error);  
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');  
      backchannel?.dispose();
      throw error;  
    }  
  },  
});  
   
cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
