import { llm } from '@livekit/agents';  
import { z } from 'zod';  
  
export const demoTool = llm.tool({  
  description: 'Get the current time in a specific timezone',  
  parameters: z.object({  
    timezone: z.string().describe('The timezone to get the time for (e.g., "America/New_York", "Europe/London")'),  
  }),  
  execute: async ({ timezone }) => {  
    const now = new Date();  
    const options = {  
      timeZone: timezone,  
      hour: '2-digit',  
      minute: '2-digit',  
      hour12: true,  
    };  
    const timeString = now.toLocaleTimeString('en-US', options);  
    return {   
      time: timeString,  
      timezone,  
      message: `The current time in ${timezone} is ${timeString}`  
    };  
  },  
});