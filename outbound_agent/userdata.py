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

@dataclass  
class UserData:  
    """Store session data across agents."""  
    ctx: JobContext