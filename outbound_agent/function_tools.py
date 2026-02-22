import json
import logging
import traceback
import asyncio
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List
from livekit.agents import function_tool, RunContext
from livekit.agents import ChatMessage, ChatContext

logger = logging.getLogger(__name__)

@function_tool    
async def end_call(context: RunContext):    
    """    
    Use this function to end the call when user has no more enquiries and natural end of conversation  
    """   
    # Wait for the agent's speech to complete before ending the call  
    await context.wait_for_playout()  
      
    room_name = context.session.userdata.ctx.room_name  
  
    async with api.LiveKitAPI() as livekit_api:  
        await livekit_api.room.delete_room(  
            api.DeleteRoomRequest(room=room_name))  
        logger.info("Room deleted successfully")  
  
    return True