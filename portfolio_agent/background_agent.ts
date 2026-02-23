// background-agent.ts
import OpenAI from 'openai';
import { TOOLS, resolveToolPayload, sendWidget, ToolName } from './openai_tools.js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are a silent UI orchestrator for Mridul Rao's portfolio website.

You listen to visitor messages and decide whether to render a UI widget or do nothing.

WHEN TO CALL A TOOL:
- Visitor asks about Mridul's skills, tech stack, or languages     → show_skills
- Visitor asks about projects, work, GitHub, or specific tech      → show_projects
- Visitor asks about career, experience, or work history           → show_experience
- Visitor asks how to contact, hire, or reach Mridul              → show_contact
- Visitor asks who Mridul is, wants an intro, or says "about"     → show_about
- Visitor asks about LinkedIn or wants to connect professionally   → show_linkedin

WHEN TO DO NOTHING (no tool call, no text, complete silence):
- Greetings: "hi", "hello", "hey", "good morning"
- Small talk with no portfolio intent: "how are you", "what's up"
- Acknowledgements: "ok", "thanks", "got it", "cool"
- Any message that contains no intent to learn about Mridul

RULES:
- Never return plain text or explanations under any circumstance.
- Never call a tool just because you are unsure — silence is the correct response when intent is absent.
- If a message contains BOTH small talk and a real question, call the appropriate tool and ignore the small talk.`;

const chatHistory: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: 'system', content: SYSTEM_PROMPT },
];

async function chat(
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
): Promise<OpenAI.Chat.ChatCompletionMessage | null> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4.1',
    messages,
    tools: TOOLS,
    tool_choice: 'auto', // model decides — silence is valid
  });

  const message = response.choices[0].message;

  if (message.tool_calls?.length) {
    chatHistory.push(message);

    for (const call of message.tool_calls) {
      const name = call.function.name as ToolName;
      const args = JSON.parse(call.function.arguments) as Record<string, unknown>;

      const { widget, payload } = resolveToolPayload(name, args);
      const result = sendWidget(widget, payload);

      chatHistory.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }

    return message;
  }

  // No tool call — intentional silence, still track in history
  chatHistory.push(message);
  return null;
}

export async function handleUserInput(
  userInput: string
): Promise<OpenAI.Chat.ChatCompletionMessage | null> {
  chatHistory.push({ role: 'user', content: userInput });
  return chat(chatHistory);
}

export function clearChatHistory(): void {
  chatHistory.length = 0;
  chatHistory.push({ role: 'system', content: SYSTEM_PROMPT });
}