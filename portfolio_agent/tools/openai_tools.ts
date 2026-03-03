// openai_tools.ts
import OpenAI from 'openai';

/**
 * Updated to match your *actual* projects + refreshed skills.
 * Also upgrades contact/link tools to avoid inventing anything:
 * - show_contact can optionally receive linkedin/github/email.
 * - show_linkedin can optionally receive a url.
 * - added show_github (useful + consistent with contact ask).
 *
 * IMPORTANT:
 * - Your existing frontend expects certain payload shapes.
 *   I preserved the old shapes (msg.projects/msg.filter, msg.skills/msg.highlight, msg.experience)
 *   and only *added* optional fields (msg.contact, msg.url, msg.featured) that won’t break old UI.
 */

const WIDGET_SERVER_BASE_URL = process.env.WIDGET_SERVER_BASE_URL ?? 'http://localhost:3001';

// ── sendWidget ───────────────────────────────────────────────────────────────
export function sendWidget(
  widget: string,
  payload: Record<string, unknown> = {}
): { status: string } {
  const msg = { type: 'YUKI_WIDGET', widget, ts: Date.now(), ...payload };

  fetch(`${WIDGET_SERVER_BASE_URL}/widgets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg),
  }).catch((err) => console.error('[sendWidget] POST failed:', err));

  console.log(`[sendWidget] → ${widget}`, payload);
  return { status: 'ok' };
}

// ── Static data (UPDATED) ────────────────────────────────────────────────────

export const SKILLS = [
  {
    group: 'Languages',
    items: ['Python', 'TypeScript', 'Node.js', 'SQL', 'Swift (iOS)', 'Kotlin (Android)'],
  },
  {
    group: 'AI / Agents',
    items: ['LLM orchestration', 'Tool-using agents', 'RAG (pgvector/BM25)', 'Structured outputs (JSON)', 'Eval mindset'],
  },
  {
    group: 'Voice / Real-time',
    items: ['LiveKit', 'Whisper', 'Streaming TTS', 'WebSockets', 'VAD', 'Low-latency pipelines'],
  },
  {
    group: 'Edge + Optimization',
    items: ['Quantization', 'llama.cpp', 'ONNX', 'CoreML/MLX (exposure)', 'Perf metrics (TTFB/RTF)'],
  },
  {
    group: 'Infrastructure',
    items: ['Docker', 'FastAPI', 'PostgreSQL', 'Redis', 'Kubernetes'],
  },
];

export const PROJECTS = [
  {
    name: 'Edge Agents',
    desc: 'Tuning + deploying small language models on edge devices (Android/iOS) with low compute. Focus on latency and memory constraints.',
    tags: ['Edge', 'SLMs', 'Android', 'iOS', 'Quantization'],
    url: 'https://github.com/mridulrao/edge_agents',
  },
  {
    name: 'Chatterbox (Real-time Streaming)',
    desc: 'Forked Chatterbox multilingual and added WebSocket + streaming for real-time voice systems. Achieved ~RTF 0.7 and ~TTFB 0.4 in the target setup.',
    tags: ['Streaming', 'WebSockets', 'TTS', 'Real-time', 'Latency'],
    url: 'https://github.com/mridulrao/chatterbox',
  },
  {
    name: 'Self Learning Agent',
    desc: 'Automation agents for browser + desktop workflows. Focus on turning ambiguity into structured, executable workflows.',
    tags: ['Automation', 'Browser', 'Desktop', 'Agents', 'Workflows'],
    url: 'https://github.com/mridulrao/self_learning_agent',
  },
  {
    name: 'Chat UI (Better Streaming Deployment)',
    desc: 'Deployment-focused chat UI with improved streaming for small language models to make interaction feel fast and usable.',
    tags: ['Streaming', 'Deployment', 'UI', 'LLMs'],
    url: 'https://github.com/mridulrao/chat_ui',
  },
];

/**
 * EXPERIENCE: kept generic to avoid fabricating employers/titles/timelines.
 * If you want, we can wire real company names + dates from your resume later.
 */
export const EXPERIENCE = [
  {
    role: 'AI Engineer (Voice + Agents)',
    company: 'Startup / Product Work',
    period: 'Recent',
    bullets: [
      'Built real-time voice/agent systems with strong focus on reliability + latency',
      'Added streaming/WebSocket pipelines and measured TTFB/RTF end-to-end',
      'Deployed/tuned smaller models for constrained environments (edge)',
    ],
  },
  {
    role: 'Systems Builder',
    company: 'Product + Infrastructure Work',
    period: 'Earlier',
    bullets: [
      'Automation workflows for browser/desktop tasks',
      'Backend systems with infra-aware implementation',
      'Emphasis on deterministic interfaces + observability for agent behavior',
    ],
  },
];

// ── Types (NEW) ──────────────────────────────────────────────────────────────

export type ContactInfo = {
  linkedin?: string | null;
  github?: string | null;
  email?: string | null;
};

// ── Tool definitions (UPDATED) ───────────────────────────────────────────────

export const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'show_about',
      description:
        'Display a visual identity card for Mridul Rao — photo, name, role, short bio. ' +
        'Call when the user asks who Mridul is, what he does, or wants an introduction.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_projects',
      description:
        "Show a card listing Mridul's featured projects with descriptions, tech tags, and GitHub links. " +
        "Call when the user asks about projects, portfolio work, GitHub repos, or topics like edge inference, streaming TTS, " +
        'automation agents, or model streaming/deployment.',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            description:
              "Optional keyword to visually highlight a matching project (e.g. 'edge', 'streaming', 'TTS', 'automation').",
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_skills',
      description:
        "Display a grouped tech-stack card (languages, AI/agents, voice/real-time, edge optimization, infrastructure). " +
        'Call when the user asks about technical skills, programming languages, tools, or tech stack.',
      parameters: {
        type: 'object',
        properties: {
          highlight: {
            type: 'string',
            description:
              "Optional skill or group to visually highlight (e.g. 'Python', 'Voice / Real-time', 'Edge + Optimization', 'WebSockets').",
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_experience',
      description:
        "Show a timeline card of Mridul's work history — roles, companies, dates, and highlights. " +
        'Call when asked about career, job history, where he worked, or professional background.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ── Contact tools (UPGRADED) ───────────────────────────────────────────────

  {
    type: 'function',
    function: {
      name: 'show_contact',
      description:
        "Display a contact card with LinkedIn, GitHub, and email. " +
        "Call when the user wants to reach out, asks for contact details or social links. " +
        "If exact links aren't available, still show the options and ask what they prefer.",
      parameters: {
        type: 'object',
        properties: {
          preferred: {
            type: 'string',
            enum: ['linkedin', 'github', 'email'],
            description: 'Optional: focus on the preferred contact method.',
          },
          linkedin: {
            type: 'string',
            description: 'Optional LinkedIn URL (only pass if you have it).',
          },
          github: {
            type: 'string',
            description: 'Optional GitHub URL (only pass if you have it).',
          },
          email: {
            type: 'string',
            description: 'Optional email address (only pass if you have it).',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_linkedin',
      description:
        "Show Mridul's LinkedIn profile card. " +
        'Call when the user asks specifically about LinkedIn or wants to connect professionally.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Optional LinkedIn URL (only pass if you have it).',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_github',
      description:
        "Show Mridul's GitHub profile card, optionally with featured repos. " +
        'Call when the user asks specifically about GitHub, repos, or wants to browse his code.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Optional GitHub profile URL (only pass if you have it).',
          },
        },
        required: [],
      },
    },
  },
];

// ── Tool executor (UPDATED) ──────────────────────────────────────────────────

export type ToolName =
  | 'show_about'
  | 'show_projects'
  | 'show_skills'
  | 'show_experience'
  | 'show_contact'
  | 'show_linkedin'
  | 'show_github';

export function resolveToolPayload(
  name: ToolName,
  args: Record<string, unknown>
): { widget: string; payload: Record<string, unknown> } {
  switch (name) {
    case 'show_about':
      return { widget: 'about', payload: {} };

    case 'show_projects':
      // frontend reads msg.projects and msg.filter directly
      return {
        widget: 'projects',
        payload: { projects: PROJECTS, filter: (args.filter as string | undefined) ?? null },
      };

    case 'show_skills':
      // frontend reads msg.skills and msg.highlight directly
      return {
        widget: 'skills',
        payload: { skills: SKILLS, highlight: (args.highlight as string | undefined) ?? null },
      };

    case 'show_experience':
      // frontend reads msg.experience directly
      return { widget: 'experience', payload: { experience: EXPERIENCE } };

    case 'show_contact': {
      // Backwards compatible: widget 'contact' still renders even with empty payload.
      // New optional payload: msg.contact + msg.preferred
      const preferred = (args.preferred as string | undefined) ?? null;

      const linkedin = (args.linkedin as string | undefined) ?? null;
      const github = (args.github as string | undefined) ?? null;
      const email = (args.email as string | undefined) ?? null;

      return {
        widget: 'contact',
        payload: {
          preferred,
          contact: { linkedin, github, email },
          // helpful extra: show featured repos even on contact screen (won't break old UI)
          featured: PROJECTS,
        },
      };
    }

    case 'show_linkedin': {
      const url = (args.url as string | undefined) ?? null;
      return { widget: 'linkedin', payload: { url } };
    }

    case 'show_github': {
      const url = (args.url as string | undefined) ?? null;
      return { widget: 'github', payload: { url, featured: PROJECTS } };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
