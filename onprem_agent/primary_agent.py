from __future__ import annotations  
import asyncio  
import logging  
import os
from dataclasses import dataclass  
from dotenv import load_dotenv  
from livekit import rtc  
from livekit.agents import (  
    Agent,  
    AgentSession,  
    AutoSubscribe,  
    JobContext,  
    WorkerOptions,  
    cli,  
)  
from livekit.plugins import openai, deepgram, silero  
from primary_agent_instructions import instructions
from base_agent import BaseAgentEnglish
from livekit.plugins import elevenlabs
from livekit.plugins import noise_cancellation
#from custom_llm import GatewayLLM
from custom_tts_lux import LuxWebSocketTTS
from livekit.agents.voice.room_io import RoomInputOptions, RoomOutputOptions


  
load_dotenv()  
  
logger = logging.getLogger("on-prem-agent")  
logger.setLevel(logging.INFO)  
  
  
@dataclass  
class UserData:  
    """Store session data across agents."""  
    ctx: JobContext  
    selected_language: str = ""  
  
  
class EnglishAgent(BaseAgentEnglish):  
    """English language support agent."""  
      
    def __init__(self) -> None:  
        super().__init__( 
            instructions=instructions,  
            stt=deepgram.STT(),  
            llm=openai.LLM(),  
            tts=LuxWebSocketTTS(
                base_url=os.getenv("LUX_TTS_BASE_URL", "ws://127.0.0.1:8765"),
                prompt_audio=os.getenv("LUX_PROMPT_AUDIO", "shahrukh_voice.mp3"),
                num_steps=int(os.getenv("LUX_TTS_NUM_STEPS", "2")),
            ),
            vad=silero.VAD.load(), 
        )  

    async def on_enter(self):  
        """Called when agent is activated."""  
        await self.session.say("Hello, tell me, who has the pleasure of calling?") 
  
  
async def entrypoint(ctx: JobContext):  
    """Main entry point for the multi-agent phone system."""  
    logger.info(f"Starting multi-agent phone system in room: {ctx.room.name}")  
      
    # Connect to room  
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)  
      
    # Wait for participant  
    participant = await ctx.wait_for_participant()  
    logger.info(f"Participant connected: {participant.identity}")  
      
    # Initialize session with UserData  
    session = AgentSession(userdata=UserData(ctx=ctx))   
    agent = EnglishAgent()  
      
      
    # Start the session with menu agent  
    await session.start(agent=agent, 
                        room=ctx.room,
                        room_input_options=RoomInputOptions(noise_cancellation=noise_cancellation.BVCTelephony()),
                        room_output_options=RoomOutputOptions(transcription_enabled=True))  
  

if __name__ == "__main__":  
 
    cli.run_app(WorkerOptions(  
        entrypoint_fnc=entrypoint,
    ))
