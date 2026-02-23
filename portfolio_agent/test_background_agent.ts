// test_background_agent.ts
import 'dotenv/config';
import * as readline from 'readline';
import { handleUserInput, clearChatHistory } from './background_agent.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function printMessage(message: Awaited<ReturnType<typeof handleUserInput>>) {
  console.log('\n── Agent Response ─────────────────────────────────────');

  if (message === null) {
    console.log('🔇 Silent  : no portfolio intent detected');
    console.log('────────────────────────────────────────────────────\n');
    return;
  }

  if (message.tool_calls?.length) {
    for (const call of message.tool_calls) {
      console.log(`🔧 Tool Called : ${call.function.name}`);
      console.log(`   Arguments   : ${call.function.arguments}`);
    }
  } else {
    console.log('🔇 Silent  : no tool call, no text');
  }

  console.log('────────────────────────────────────────────────────\n');
}

async function main() {
  console.log('🤖 Background Agent Test REPL');
  console.log('   Commands: "exit" to quit | "clear" to reset chat history\n');

  while (true) {
    const input = await prompt('You: ');

    if (!input.trim()) continue;

    if (input.trim().toLowerCase() === 'exit') {
      console.log('Goodbye!');
      rl.close();
      break;
    }

    if (input.trim().toLowerCase() === 'clear') {
      clearChatHistory();
      console.log('✅ Chat history cleared.\n');
      continue;
    }

    try {
      console.log('⏳ Thinking...');
      const response = await handleUserInput(input.trim());
      printMessage(response);
    } catch (err) {
      console.error('❌ Error:', err);
    }
  }
}

main();