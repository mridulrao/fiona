import { llm } from '@livekit/agents';
import { z } from 'zod';

export async function sendWidget(ctx, widget, payload = {}) {
  const msg = JSON.stringify({ type: 'YUKI_WIDGET', widget, ts: Date.now(), ...payload });
  await ctx.room.localParticipant.publishData(new TextEncoder().encode(msg), { reliable: true });
}

/**
 * Updated data to match your *actual* work + repos provided.
 * Notes:
 * - I did NOT invent contact links/emails. Those stay as optional inputs to the tools.
 * - Projects now: edge_agents, chatterbox, self_learning_agent, chat_ui
 * - Skills updated to reflect edge inference + streaming + voice infra focus.
 */

const SKILLS = [
  {
    group: 'Languages',
    items: ['Python', 'TypeScript', 'Node.js', 'SQL', 'Swift (iOS)', 'Kotlin (Android)'],
  },
  {
    group: 'AI / Agents',
    items: [
      'LLM orchestration',
      'Tool-using agents',
      'RAG (pgvector/BM25)',
      'Prompting + eval',
      'Structured outputs (JSON)',
    ],
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
    items: ['Docker', 'FastAPI', 'PostgreSQL', 'Redis', 'Kubernetes', 'CI/CD (basic)'],
  },
];

const PROJECTS = [
  {
    name: 'Edge Agents',
    desc:
      'Tuning + deploying small language models on edge devices (Android/iOS) with low compute. ' +
      'Focus on latency, memory, and on-device constraints.',
    tags: ['Edge', 'SLMs', 'Android', 'iOS', 'Quantization'],
    url: 'https://github.com/mridulrao/edge_agents',
  },
  {
    name: 'Chatterbox (Real-time Streaming)',
    desc:
      'Forked Chatterbox multilingual and added WebSocket + streaming so it can run in real-time ' +
      'systems like voice agents. Achieved ~RTF 0.7 and ~TTFB 0.4 in your setup.',
    tags: ['Streaming', 'WebSockets', 'TTS', 'Real-time', 'Latency'],
    url: 'https://github.com/mridulrao/chatterbox',
  },
  {
    name: 'Self Learning Agent',
    desc:
      'Automation agents for browser + desktop workflows. Focus on capturing actions, turning ' +
      'ambiguity into structured steps, and making execution reliable.',
    tags: ['Automation', 'Browser', 'Desktop', 'Agents', 'Workflows'],
    url: 'https://github.com/mridulrao/self_learning_agent',
  },
  {
    name: 'Chat UI (Better Streaming Deployment)',
    desc:
      'A deployment-focused chat UI with improved streaming for small language models. ' +
      'Built to make model interaction feel fast and usable.',
    tags: ['Streaming', 'Deployment', 'UI', 'LLMs'],
    url: 'https://github.com/mridulrao/chat_ui',
  },
];

// Keep experience generic unless you want to hardcode real company names/timelines.
// This avoids accidental misrepresentation.
const EXPERIENCE = [
  {
    role: 'AI Engineer (Voice + Agents)',
    company: 'Startup / Product Work',
    period: 'Recent',
    bullets: [
      'Built real-time voice/agent systems with strong focus on reliability + latency',
      'Worked on streaming pipelines (TTFB/RTF), WebSockets, and production behaviors',
      'Deployed and tuned smaller models for constrained environments',
    ],
  },
  {
    role: 'Software Engineer / Systems Builder',
    company: 'Product + Infrastructure Work',
    period: 'Earlier',
    bullets: [
      'Automation workflows for browser/desktop tasks',
      'Backend systems and infra-aware implementation',
      'Built practical tools with observability and deterministic interfaces in mind',
    ],
  },
];

/**
 * Optional: centralize contact info so it can be passed in at wiring time.
 * This prevents hardcoding personal links/emails in source.
 */
type ContactInfo = {
  linkedin?: string | null;
  github?: string | null;
  email?: string | null;
};

/**
 * showAbout
 * Displays a compact identity card.
 */
export function createShowAbout(ctx) {
  return llm.tool({
    description:
      "Display a visual identity card for Mridul Rao — shows his photo, name, role, and " +
      "a short bio. Call this when the user asks who Mridul is, what he does, wants an " +
      "introduction, or asks to see what he looks like.",
    parameters: z.object({}),
    execute: async () => {
      await sendWidget(ctx, 'about');
      return { success: true, message: 'Identity card displayed.' };
    },
  });
}

/**
 * showProjects
 * Updated to your actual repos.
 * Adds stronger filter semantics: matches name/desc/tags.
 */
export function createShowProjects(ctx) {
  return llm.tool({
    description:
      "Show a card listing Mridul's featured projects — each with a description, tech tags, " +
      "and a GitHub link. Call this when the user asks about his projects, what he has built, " +
      "his GitHub repos, portfolio work, or topics like edge inference, streaming TTS, " +
      "automation agents, or streaming deployment.",
    parameters: z.object({
      filter: z
        .string()
        .optional()
        .describe(
          "Optional keyword to highlight a specific project (e.g. 'edge', 'streaming', 'TTS', 'automation'). " +
            'If provided, matching rows will be highlighted.'
        ),
    }),
    execute: async ({ filter }) => {
      await sendWidget(ctx, 'projects', {
        projects: PROJECTS,
        filter: filter ?? null,
      });
      return {
        success: true,
        message: filter
          ? `Projects card shown, highlighting "${filter}".`
          : `Projects card shown (${PROJECTS.length} projects).`,
      };
    },
  });
}

/**
 * showSkills
 * Updated categories to reflect your edge + streaming work.
 */
export function createShowSkills(ctx) {
  return llm.tool({
    description:
      "Display a grouped tech-stack card showing Mridul's skills across languages, AI/agents, " +
      "voice/real-time, edge optimization, and infrastructure. Call this when the user asks " +
      "about his technical skills, programming languages, tools he uses, or his tech stack.",
    parameters: z.object({
      highlight: z
        .string()
        .optional()
        .describe(
          "Optional skill or group to visually highlight (e.g. 'Python', 'Edge + Optimization', 'LiveKit', 'WebSockets')."
        ),
    }),
    execute: async ({ highlight }) => {
      await sendWidget(ctx, 'skills', {
        skills: SKILLS,
        highlight: highlight ?? null,
      });
      return {
        success: true,
        message: highlight ? `Skills card shown, highlighting "${highlight}".` : 'Skills card shown.',
      };
    },
  });
}

/**
 * showExperience
 * Kept intentionally generic to avoid fabricating company names.
 */
export function createShowExperience(ctx) {
  return llm.tool({
    description:
      "Show a timeline card of Mridul's work experience — roles, companies, dates, and bullet highlights. " +
      "Call this when the user asks about his career, job history, where he has worked, or his professional experience.",
    parameters: z.object({}),
    execute: async () => {
      await sendWidget(ctx, 'experience', { experience: EXPERIENCE });
      return { success: true, message: `Experience card shown (${EXPERIENCE.length} roles).` };
    },
  });
}

/**
 * showContact
 * UPDATED: returns LinkedIn/GitHub/email in a single card.
 * IMPORTANT: we do not hardcode personal contact info unless you pass it in.
 *
 * Usage:
 *   const showContact = createShowContact(ctx, { linkedin: '...', github: '...', email: '...' })
 */
export function createShowContact(ctx, contact: ContactInfo = {}) {
  return llm.tool({
    description:
      "Display a contact card with Mridul's LinkedIn, GitHub, and email. " +
      "Call this when the user asks how to contact him, wants to reach out, asks for email, " +
      "social links, or says they want to connect. If exact links are not available, " +
      "still show the contact options and ask the user what they prefer (LinkedIn/GitHub/email).",
    parameters: z.object({
      preferred: z
        .enum(['linkedin', 'github', 'email'])
        .optional()
        .describe('Optional: focus the card on the preferred contact method.'),
    }),
    execute: async ({ preferred }) => {
      await sendWidget(ctx, 'contact', {
        contact: {
          linkedin: contact.linkedin ?? null,
          github: contact.github ?? null,
          email: contact.email ?? null,
        },
        preferred: preferred ?? null,
      });

      // Return message is deterministic and doesn’t leak invented links.
      const available = [
        contact.linkedin ? 'LinkedIn' : null,
        contact.github ? 'GitHub' : null,
        contact.email ? 'Email' : null,
      ].filter(Boolean);

      return {
        success: true,
        message:
          available.length > 0
            ? `Contact card displayed (${available.join(', ')}).`
            : 'Contact card displayed (LinkedIn / GitHub / Email options).',
      };
    },
  });
}

/**
 * showLinkedIn
 * UPDATED: optionally takes URL so you can pass it in.
 */
export function createShowLinkedin(ctx, linkedinUrl?: string) {
  return llm.tool({
    description:
      "Show Mridul's LinkedIn profile card. Call this when the user asks specifically about his LinkedIn " +
      "or wants to connect professionally. If the URL is not available, show the intent and suggest reaching out via LinkedIn.",
    parameters: z.object({}),
    execute: async () => {
      await sendWidget(ctx, 'linkedin', { url: linkedinUrl ?? null });
      return { success: true, message: 'LinkedIn card displayed.' };
    },
  });
}

/**
 * Optional: showGitHub tool (new)
 * Useful when they ask "what's his GitHub?"
 */
export function createShowGithub(ctx, githubUrl?: string) {
  return llm.tool({
    description:
      "Show Mridul's GitHub profile card. Call this when the user asks specifically about his GitHub, " +
      "repos, or wants to browse his code. If the URL is not available, show a GitHub option and suggest asking for the profile link.",
    parameters: z.object({}),
    execute: async () => {
      await sendWidget(ctx, 'github', { url: githubUrl ?? null, featured: PROJECTS });
      return { success: true, message: 'GitHub card displayed.' };
    },
  });
}