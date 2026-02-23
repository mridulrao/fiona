import { defineAgent, JobContext, WorkerOptions, voice, metrics } from '@livekit/agents';  
import * as deepgram from '@livekit/agents-plugin-deepgram';  
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';  
import * as openai from '@livekit/agents-plugin-openai';  
import * as silero from '@livekit/agents-plugin-silero';  
import { BackgroundVoiceCancellation } from '@livekit/noise-cancellation-node';  
import dotenv from 'dotenv';  
import { fileURLToPath } from 'node:url';  
import { cli } from '@livekit/agents';  
  
import { INSTRUCTIONS } from './prompt.js';  
import { handleUserInput, clearChatHistory } from './background_agent.js';

dotenv.config({ path: '.env.local' });  
  
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
    });  
  }  
}  
  
export default defineAgent({  
  prewarm: async (proc) => {  
    console.log('Prewarming agent...');  
    try {  
      proc.userData.vad = await silero.VAD.load();  
      console.log('VAD loaded');  
    } catch (error) {  
      console.error('Failed to load VAD:', error);  
      throw error;  
    }  
  },  
  entry: async (ctx: JobContext) => {    
  
    let session: voice.AgentSession;  
  
    try {  
      const stt = new deepgram.STT();   
      const llm = new openai.LLM({  
        baseURL: 'https://api.groq.com/openai/v1',  
        apiKey: process.env.GROQ_API_KEY,  
        model: 'llama-3.1-8b-instant',  
      });   
      const tts = new elevenlabs.TTS({  
        voice: {   
          id: "0ptCJp0xgdabdcpVtCB5"   
        },  
        model: "eleven_flash_v2_5"  
      });  

      session = new voice.AgentSession({  
        vad: ctx.proc.userData.vad! as silero.VAD,  
        stt,  
        llm,  
        tts,  
      });  

      await session.start({  
        agent: new Assistant(),  
        room: ctx.room,  
        inputOptions: {  
          noiseCancellation: BackgroundVoiceCancellation(),  
        },  
      });  
      await ctx.connect();  

      // ── User transcript ──────────────────────────────────────────────
      session.on('user_input_transcribed', async (event: any) => {  
        if (event.isFinal) {  
          const text = event.transcript;  
          console.log('User:', text);  
          await handleUserInput(text);  
          if (text) {  
            ctx.room.localParticipant.publishData(  
              Buffer.from(JSON.stringify({ type: 'TRANSCRIPT', role: 'user', text })),  
              { reliable: true }  
            );  
          }  
        }  
      });

      // ── Agent transcript ─────────────────────────────────────────────
      session.on('conversation_item_added', (event: any) => {
        if (event.item.type === 'message') {
          const text: string = event.item.content;
          console.log('Agent:', text);
          if (text) {
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
      throw error;  
    }  
  },  
});  
   
cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));