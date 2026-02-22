import asyncio  
import json  
import os  
from livekit import api 
from dotenv import load_dotenv 
load_dotenv()
  
async def make_call(phone_number: str, task: str):  
    """Create a dispatch and initiate an outbound call with custom instructions"""  
    lkapi = api.LiveKitAPI()  
      
    # Create unique room name  
    room_name = f"outbound-call-{phone_number.replace('+', '')}"  
      
    # Package phone number and task as JSON metadata  
    metadata = json.dumps({  
        "phone_number": phone_number,  
        "task": task  
    })  
      
    # Create agent dispatch  
    dispatch = await lkapi.agent_dispatch.create_dispatch(  
        api.CreateAgentDispatchRequest(  
            agent_name="outbound-caller",  # Must match your agent_name in WorkerOptions  
            room=room_name,  
            metadata=metadata  
        )  
    )  
      
    await lkapi.aclose()  
    return dispatch  
  
# Usage  
asyncio.run(make_call("+12139945390", "Ask for her faviorite icecream, Name of the person: Jeel Doshi"))