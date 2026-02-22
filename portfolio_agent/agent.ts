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
import { demoTool } from './tools.js';  
  
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
      // tools: { demoTool }  
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
    console.log('Agent entry point called');  
  
    let session: voice.AgentSession;  
  
    try {  
      console.log('Initializing plugins...');  
          
      // Test each plugin initialization separately  
      console.log('Initializing Deepgram STT...');  
      const stt = new deepgram.STT();  
          
      console.log('Initializing OpenAI LLM...');  
      const llm = new openai.LLM({  
        baseURL: 'https://api.groq.com/openai/v1',  
        apiKey: process.env.GROQ_API_KEY,  
        model: 'llama-3.3-70b-versatile',  
      });  
          
      console.log('Initializing ElevenLabs TTS...');  
      const tts = new elevenlabs.TTS({  
        voice: {   
          id: "0ptCJp0xgdabdcpVtCB5"   
        },  
        model: "eleven_flash_v2_5"  
      });  
   
      console.log('Creating AgentSession...');  
      session = new voice.AgentSession({  
        vad: ctx.proc.userData.vad! as silero.VAD,  
        stt,  
        llm,  
        tts,  
      });  
   
      console.log('Starting session...');  
      await session.start({  
        agent: new Assistant(),  
        room: ctx.room,  
        inputOptions: {  
          // LiveKit Cloud enhanced noise cancellation  
          // - If self-hosting, omit this parameter  
          // - For telephony applications, use `BackgroundVoiceCancellationTelephony` for best results  
          noiseCancellation: BackgroundVoiceCancellation(),  
        },  
      });  
      console.log('Agent session started');  
   
      console.log('Connecting to room...');  
      await ctx.connect();  
      console.log('Connected to LiveKit server');  
   
      console.log('Generating initial reply...');  
      await session.generateReply({  
        instructions: 'Greet the user and offer help.',  
      });  
      console.log('Initial reply sent');  
   
    } catch (error) {  
      console.error('Error in agent entry:', error);  
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');  
      throw error;  
    }  
  },  
});  
   
cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));