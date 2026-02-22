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
    def __init__(self, *args, **kwargs):  
        kwargs.setdefault("allow_interruptions", True)  
        super().__init__(*args, **kwargs)



