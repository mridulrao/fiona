import { llm } from '@livekit/agents';  
import { z } from 'zod'; 


export async function sendWidget(ctx, widget, payload = {}) {
  const msg = JSON.stringify({ type: 'YUKI_WIDGET', widget, ts: Date.now(), ...payload });
  await ctx.room.localParticipant.publishData(
    new TextEncoder().encode(msg),
    { reliable: true }
  );
}

const SKILLS = [
  {
    group: 'Languages',
    items: ['Python', 'TypeScript', 'Node.js', 'SQL'],
  },
  {
    group: 'AI / ML',
    items: ['PyTorch', 'Azure OpenAI', 'Whisper', 'pgvector', 'BM25'],
  },
  {
    group: 'Infrastructure',
    items: ['Docker', 'FastAPI', 'PostgreSQL', 'Redis', 'Kubernetes'],
  },
  {
    group: 'Platforms',
    items: ['LiveKit', 'ServiceNow', 'Azure', 'GCP', 'Apigee'],
  },
];

const PROJECTS = [
  {
    name:  'LiveKit Voice Agent',
    desc:  'Real-time AI voice assistant with STT/TTS pipeline, VAD, and Hindi support',
    tags:  ['LiveKit', 'Whisper', 'Azure Speech'],
    url:   'https://github.com/mridulrao/livekit-voice-agent',
  },
  {
    name:  'RAG Knowledge Base',
    desc:  'pgvector-backed retrieval pipeline with circuit breaker & sync worker',
    tags:  ['pgvector', 'FastAPI', 'Azure OpenAI'],
    url:   'https://github.com/mridulrao/rag-knowledge-base',
  },
  {
    name:  'ServiceNow Integration',
    desc:  'Async ticket management client with Apigee/SPARC auth and incident handling',
    tags:  ['ServiceNow', 'Python', 'REST'],
    url:   'https://github.com/mridulrao/servicenow-client',
  },
  {
    name:  'Workflow Recorder',
    desc:  'Browser + desktop interaction recorder that generates executable automation workflows',
    tags:  ['Playwright', 'Electron', 'Vision LLM'],
    url:   'https://github.com/mridulrao/workflow-recorder',
  },
];

const EXPERIENCE = [
  {
    role:    'AI Engineer',
    company: 'Current Role',
    period:  '2023 – Present',
    bullets: [
      'Voice agents with LiveKit + custom STT/TTS pipelines',
      'RAG systems on pgvector with Azure OpenAI',
      'ServiceNow automation via Apigee gateway',
    ],
  },
  {
    role:    'Software Engineer',
    company: 'Previous Role',
    period:  '2021 – 2023',
    bullets: [
      'Multi-agent IT support orchestration',
      'Docker / Kubernetes containerised deployments',
      'Edge model inference on Android & iOS',
    ],
  },
];

/**
 * showAbout
 * Displays a compact identity card: Mridul's photo, name, role, and a
 * one-line bio. Use this as a natural "introduction" whenever the user
 * wants to know who they're talking about or to put a face to the name.
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
      return { success: true, message: "Identity card displayed." };
    },
  });
}

export function createShowProjects(ctx) {
  return llm.tool({
    description:
      "Show a card listing Mridul's featured projects — each with a description, " +
      "tech tags, and a GitHub link. Call this when the user asks about his projects, " +
      "what he has built, his GitHub repos, portfolio work, or any specific project " +
      "topic like voice agents, RAG, ServiceNow, or workflow automation.",
    parameters: z.object({
      filter: z
        .string()
        .optional()
        .describe(
          "Optional keyword to highlight a specific project (e.g. 'voice', 'RAG', 'ServiceNow'). " +
          "If provided the matching project row will be visually highlighted."
        ),
    }),
    execute: async ({ filter }) => {
      await sendWidget(ctx, 'projects', { projects: PROJECTS, filter: filter ?? null });
      return {
        success: true,
        message: filter
          ? `Projects card shown, highlighting "${filter}".`
          : `Projects card shown (${PROJECTS.length} projects).`,
      };
    },
  });
}

export function createShowSkills(ctx) {
  return llm.tool({
    description:
      "Display a grouped tech-stack card showing Mridul's skills across languages, " +
      "AI/ML, infrastructure, and platforms. Call this when the user asks about his " +
      "technical skills, programming languages, tools he uses, or his tech stack.",
    parameters: z.object({
      highlight: z
        .string()
        .optional()
        .describe(
          "Optional skill or group to visually highlight (e.g. 'Python', 'AI / ML', 'LiveKit')."
        ),
    }),
    execute: async ({ highlight }) => {
      await sendWidget(ctx, 'skills', { skills: SKILLS, highlight: highlight ?? null });
      return {
        success: true,
        message: highlight
          ? `Skills card shown, highlighting "${highlight}".`
          : "Skills card shown.",
      };
    },
  });
}

export function createShowExperience(ctx) {
  return llm.tool({
    description:
      "Show a timeline card of Mridul's work experience — roles, companies, dates, and " +
      "bullet highlights. Call this when the user asks about his career, job history, " +
      "where he has worked, or his professional experience.",
    parameters: z.object({}),
    execute: async () => {
      await sendWidget(ctx, 'experience', { experience: EXPERIENCE });
      return { success: true, message: `Experience card shown (${EXPERIENCE.length} roles).` };
    },
  });
}

export function createShowContact(ctx) {
  return llm.tool({
    description:
      "Display a contact card with Mridul's GitHub, LinkedIn, and email links. " +
      "Call this when the user asks how to contact him, wants to reach out, asks " +
      "for his email, social links, or says they want to connect.",
    parameters: z.object({}),
    execute: async () => {
      await sendWidget(ctx, 'contact');
      return { success: true, message: "Contact card displayed." };
    },
  });
}

export function createShowLinkedin(ctx) {
  return llm.tool({
    description:
      "Show Mridul's LinkedIn profile card. Call this when the user asks specifically " +
      "about his LinkedIn, wants to connect professionally on LinkedIn, or asks " +
      "for a link to his professional profile page.",
    parameters: z.object({}),
    execute: async () => {
      await sendWidget(ctx, 'linkedin');
      return { success: true, message: "LinkedIn card displayed." };
    },
  });
}