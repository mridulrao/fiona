from __future__ import annotations  
import asyncio  
import logging  
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
from livekit.plugins import openai, deepgram, google, silero  
from primary_agent_instructions import instructions
from base_agent import BaseAgentEnglish, BaseAgentHindi
from livekit.plugins import elevenlabs
from livekit.plugins import noise_cancellation


  
load_dotenv()  
  
logger = logging.getLogger("clinic-multiligual-agent")  
logger.setLevel(logging.INFO)  
  
  
@dataclass  
class UserData:  
    """Store session data across agents."""  
    ctx: JobContext  
    selected_language: str = ""  
  
  
# Define language-specific agents  
class EnglishAgent(BaseAgentEnglish):  
    """English language support agent."""  
      
    def __init__(self) -> None:  
        super().__init__( 
            agent_name="PrimaryAgentEnglish", 
            instructions=instructions,  
            stt=google.STT(
                model="latest_long",
                languages="en-IN",
                credentials_file="google_creds.json",
                punctuate=False 
            ),  
            llm=openai.LLM(),  
            tts=elevenlabs.TTS(
              voice_id="Xb7hH8MSUJpSbSDYk0k2",
              model="eleven_multilingual_v2",
              language="en"
           ),  
            vad=silero.VAD.load(min_speech_duration=0.07, 
                                min_silence_duration=0.7, 
                                activation_threshold=0.5), 
        )  
      
    async def on_enter(self):  
        """Called when agent is activated."""  
        logger.info("English agent activated")  
        await self.session.say("Hello, this is Fiona! How can I assist you?")  
  
  
class HindiAgent(BaseAgentHindi):  
    """Hindi language support agent."""  
      
    def __init__(self) -> None:  
        super().__init__(  
            agent_name="PrimaryAgentHindi",
            instructions=instructions,  
            stt=google.STT(
                model="latest_long",
                languages="hi-IN",
                credentials_file="google_creds.json",
                punctuate=False 
            ),  
            llm=openai.LLM(),  
            tts=elevenlabs.TTS(
              voice_id="Xb7hH8MSUJpSbSDYk0k2",
              model="eleven_multilingual_v2",
              language="hi"
           ),  
            vad=silero.VAD.load(min_speech_duration=0.07, 
                                min_silence_duration=0.7, 
                                activation_threshold=0.5), 
        )  
      
    async def on_enter(self):  
        """Called when agent is activated."""  
        logger.info("Hindi agent activated")  
        await self.session.say("नमस्ते, मैं रिया बोल रही हूँ! मैं आपकी क्या मदद कर सकती हूँ?")  
  
  
class MenuAgent(Agent):  
    """Initial menu agent that handles DTMF routing."""  
      
    def __init__(self) -> None:  
        super().__init__(  
            instructions="You are a helpful assistant.",  
            tts=elevenlabs.TTS(
              voice_id="Xb7hH8MSUJpSbSDYk0k2",
              model="eleven_multilingual_v2",
              language="hi"
           ),
        )  
        self.agent_mapping = {  
            "1": EnglishAgent,  
            "2": HindiAgent,  
        }  
      
    async def on_enter(self):  
        """Present the multilingual menu."""  
        logger.info("Menu agent activated - presenting options")  
          
        # Multilingual menu prompt  
        menu = (  
            "Welcome! Press 1 for English agent. "  
            "हिंदी एजेंट के लिए 2 दबाएं। "
        )  
        await self.session.say(menu)  
      
    async def handle_dtmf(self, digit: str) -> Agent | None:  
        """Handle DTMF input and return the appropriate agent."""  
        if digit in self.agent_mapping:  
            agent_class = self.agent_mapping[digit]  
            logger.info(f"Activating agent for digit {digit}")  
            return agent_class()  
        else:  
            await self.session.say("Invalid option. Please try again.")  
            return None  
  
  
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
      
    # Start with menu agent  
    menu_agent = MenuAgent()  
      
    # Set up DTMF event handler  
    @ctx.room.on("sip_dtmf_received")  
    def handle_dtmf(dtmf_event: rtc.SipDTMF):  
        digit = dtmf_event.digit  
        logger.info(f"DTMF received - Digit: '{digit}'")  
          
        # Switch to the selected agent  
        def switch_agent():  
            if digit in menu_agent.agent_mapping:  
                agent_class = menu_agent.agent_mapping[digit]  
                logger.info(f"Activating agent for digit {digit}")  
                new_agent = agent_class()  
                session.update_agent(new_agent)  
            else:  
                logger.warning(f"Invalid DTMF digit: {digit}")  
          
        # Call synchronously since update_agent is not async  
        switch_agent() 
      
    # Start the session with menu agent  
    await session.start(agent=menu_agent, 
                        room=ctx.room,
                        room_input_options=RoomInputOptions(noise_cancellation=noise_cancellation.BVCTelephony()),
                        room_output_options=RoomOutputOptions(transcription_enabled=True))  
  

if __name__ == "__main__":  
    from livekit.agents import JobExecutorType  
      
    cli.run_app(WorkerOptions(  
        entrypoint_fnc=entrypoint,
        agent_name="clinic_agent",  
        job_executor_type=JobExecutorType.THREAD  # Use threads instead of processes  
    ))

