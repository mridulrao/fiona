import asyncio
import json
import logging
import os
import random
import re
import time
from dataclasses import dataclass
from typing import AsyncIterable, Dict, List, Optional

from livekit import rtc
from livekit.agents import (
    ChatContext,
    ChatMessage,
    FunctionTool,
    JobProcess,
    llm,
    stt,
    tts,
)
from livekit.agents.voice import Agent, ModelSettings, RunContext

logger = logging.getLogger("BaseAgent")


"""

Chatcontext operations - ['add_message', 'copy', 'empty', 'find_insertion_index', 'from_dict', 'get_by_id', 'index_by_id', 'insert', 'items', 'readonly', 'to_dict', 'to_provider_format', 'truncate']
"""


class BaseAgentEnglish(Agent):
    def __init__(self, agent_name: str, *args, **kwargs):
        kwargs.setdefault('allow_interruptions', True) 
        super().__init__(*args, **kwargs) 

        self.filler_words = [
            ", Okay",
            ", I see",
            ", Understood",
            ", Got it",
            ", Let me check",
            ", One moment",
            ", Alright",
        ]

    async def play_filler_words(self, duration: float = 1.0, interval: float = 0.5):
        """
        Play filler words during processing delays to maintain engagement
        """
        # Check if we should interrupt filler words  
        if hasattr(self.session, '_current_speech') and self.session._current_speech is not None:  
            return  
          
        filler = random.choice(self.filler_words)  
        # Use allow_interruptions=True for filler words so they can be stopped  
        self.session.say(filler, add_to_chat_ctx=False, allow_interruptions=True)


    async def on_user_turn_completed(
        self,
        turn_ctx: ChatContext,
        new_message: ChatMessage,
    ) -> None:
        # Only play filler words if no current speech is active  
        if not hasattr(self.session, '_current_speech') or self.session._current_speech is None:  
            await self.play_filler_words()

class BaseAgentHindi(Agent):
    def __init__(self, agent_name: str, *args, **kwargs):
        kwargs.setdefault('allow_interruptions', True) 
        super().__init__(*args, **kwargs) 

        self.filler_words = [
            ", एक मिनट रुको",
            ", ठीक है",
        ]

    async def play_filler_words(self, duration: float = 1.0, interval: float = 0.5):
        """
        Play filler words during processing delays to maintain engagement
        """
        # Check if we should interrupt filler words  
        if hasattr(self.session, '_current_speech') and self.session._current_speech is not None:  
            return  
          
        filler = random.choice(self.filler_words)  
        # Use allow_interruptions=True for filler words so they can be stopped  
        self.session.say(filler, add_to_chat_ctx=False, allow_interruptions=True)


    async def on_user_turn_completed(
        self,
        turn_ctx: ChatContext,
        new_message: ChatMessage,
    ) -> None:
        # Only play filler words if no current speech is active  
        if not hasattr(self.session, '_current_speech') or self.session._current_speech is None:  
            await self.play_filler_words()



    async def on_user_turn_completed(
        self,
        turn_ctx: ChatContext,
        new_message: ChatMessage,
    ) -> None:
        # Only play filler words if no current speech is active  
        if not hasattr(self.session, '_current_speech') or self.session._current_speech is None:  
            await self.play_filler_words()
