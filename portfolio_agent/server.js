import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import express from 'express';
import { AccessToken } from 'livekit-server-sdk';
import cors from 'cors';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const { PrismaClient } = prismaPkg;

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const PORT = Number(process.env.PORT ?? 3001);
const DATABASE_URL = process.env.DATABASE_URL ?? null;
const OBSERVABILITY_INGEST_KEY = process.env.OBSERVABILITY_INGEST_KEY ?? null;
const rawMaxSessionTurns = Number.parseInt(String(process.env.OBSERVABILITY_MAX_SESSION_TURNS ?? '500'), 10);
const MAX_SESSION_TURNS =
  Number.isFinite(rawMaxSessionTurns) && rawMaxSessionTurns > 0 ? rawMaxSessionTurns : 500;
const DASHBOARD_USERNAME = process.env.DASHBOARD_USERNAME ?? null;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD ?? null;
const rawDashboardSessionTtlMs = Number.parseInt(
  String(process.env.DASHBOARD_SESSION_TTL_MS ?? `${8 * 60 * 60 * 1000}`),
  10,
);
const DASHBOARD_SESSION_TTL_MS =
  Number.isFinite(rawDashboardSessionTtlMs) && rawDashboardSessionTtlMs > 0
    ? rawDashboardSessionTtlMs
    : 8 * 60 * 60 * 1000;
const DASHBOARD_AUTH_ENABLED = Boolean(DASHBOARD_USERNAME && DASHBOARD_PASSWORD);
const prisma = DATABASE_URL
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL }),
    })
  : null;

const dashboardSessions = new Map();

console.log('LIVEKIT_URL:', LIVEKIT_URL);
console.log('LIVEKIT_API_KEY set?', !!API_KEY);
console.log('LIVEKIT_API_SECRET set?', !!API_SECRET);
console.log('DATABASE_URL set?', !!DATABASE_URL);
console.log('DASHBOARD_AUTH_ENABLED:', DASHBOARD_AUTH_ENABLED);
if ((DASHBOARD_USERNAME && !DASHBOARD_PASSWORD) || (!DASHBOARD_USERNAME && DASHBOARD_PASSWORD)) {
  console.warn(
    'Dashboard auth env is incomplete. Set both DASHBOARD_USERNAME and DASHBOARD_PASSWORD to enable dashboard auth.',
  );
}

// Serve frontend directly from the same server.
app.use(express.static(__dirname));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/dashboard/auth-status', (req, res) => {
  res.json({
    enabled: DASHBOARD_AUTH_ENABLED,
    authenticated: hasValidDashboardSession(req),
  });
});

app.post('/dashboard/login', (req, res) => {
  if (!DASHBOARD_AUTH_ENABLED) {
    res.json({ status: 'ok', authEnabled: false });
    return;
  }

  const username = req.body?.username ? String(req.body.username) : '';
  const password = req.body?.password ? String(req.body.password) : '';
  if (username !== DASHBOARD_USERNAME || password !== DASHBOARD_PASSWORD) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  pruneExpiredDashboardSessions();
  const sessionToken = crypto.randomBytes(32).toString('hex');
  dashboardSessions.set(sessionToken, Date.now() + DASHBOARD_SESSION_TTL_MS);
  setDashboardSessionCookie(res, sessionToken);
  res.json({ status: 'ok' });
});

app.post('/dashboard/logout', (req, res) => {
  const token = getDashboardSessionToken(req);
  if (token) dashboardSessions.delete(token);
  clearDashboardSessionCookie(res);
  res.json({ status: 'ok' });
});

function hasDatabaseConfig() {
  return Boolean(prisma);
}

function hasSessionModel() {
  return Boolean(prisma && prisma.agentObservabilitySession);
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function updateToolUsageByName(existingSummary, { source, eventType, toolName, status, durationMs }) {
  const summary = normalizeObject(existingSummary);
  const existingMap = normalizeObject(summary.toolUsageByName);
  if (!(source === 'tool' && eventType === 'tool_execution' && toolName && status)) {
    return existingMap;
  }

  const toolKey = String(toolName);
  const current = normalizeObject(existingMap[toolKey]);
  const prevCount = Number(current.count ?? 0);
  const prevErrors = Number(current.errors ?? 0);
  const prevDurationTotalMs = Number(current.durationTotalMs ?? 0);
  const nextCount = prevCount + 1;
  const nextErrors = status === 'error' ? prevErrors + 1 : prevErrors;
  const nextDurationTotalMs =
    Number.isFinite(durationMs) && durationMs !== null ? prevDurationTotalMs + Number(durationMs) : prevDurationTotalMs;

  return {
    ...existingMap,
    [toolKey]: {
      count: nextCount,
      errors: nextErrors,
      durationTotalMs: nextDurationTotalMs,
      avgDurationMs: nextCount > 0 ? Math.round(nextDurationTotalMs / nextCount) : 0,
      lastStatus: status,
    },
  };
}

function normalizeTurns(value) {
  return Array.isArray(value) ? value : [];
}

function toApiSession(row) {
  return {
    session_id: row.sessionId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    room_name: row.roomName,
    source: row.source,
    started_at: row.startedAt,
    ended_at: row.endedAt,
    status: row.status,
    event_count: row.eventCount,
    tool_calls: row.toolCalls,
    tool_errors: row.toolErrors,
    metrics_count: row.metricsCount,
    duration_ms: row.durationMs,
    summary: row.summary,
    turns: normalizeTurns(row.turns),
  };
}

function requireIngestKey(req, res, next) {
  if (!OBSERVABILITY_INGEST_KEY) {
    next();
    return;
  }

  const provided = req.header('x-observability-key');
  if (provided !== OBSERVABILITY_INGEST_KEY) {
    res.status(401).json({ error: 'Invalid observability ingest key' });
    return;
  }

  next();
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return String(cookieHeader)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const separatorIndex = pair.indexOf('=');
      if (separatorIndex < 0) return acc;
      const key = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function pruneExpiredDashboardSessions(nowMs = Date.now()) {
  for (const [token, expiresAtMs] of dashboardSessions.entries()) {
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
      dashboardSessions.delete(token);
    }
  }
}

function getDashboardSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies.dashboard_session ?? null;
}

function hasValidDashboardSession(req) {
  if (!DASHBOARD_AUTH_ENABLED) return true;
  pruneExpiredDashboardSessions();
  const token = getDashboardSessionToken(req);
  if (!token) return false;
  const expiresAtMs = dashboardSessions.get(token);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    dashboardSessions.delete(token);
    return false;
  }
  return true;
}

function setDashboardSessionCookie(res, token) {
  const maxAgeSeconds = Math.floor(DASHBOARD_SESSION_TTL_MS / 1000);
  const secure = process.env.NODE_ENV === 'production';
  const cookieParts = [
    `dashboard_session=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (secure) cookieParts.push('Secure');
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function clearDashboardSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  const cookieParts = [
    'dashboard_session=',
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (secure) cookieParts.push('Secure');
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function requireDashboardAuth(req, res, next) {
  if (hasValidDashboardSession(req)) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// ── Observability ingest + query (Prisma/Postgres-backed) ───────────────────
app.post('/observability/events', requireIngestKey, async (req, res) => {
  if (!hasDatabaseConfig()) {
    res.status(503).json({ error: 'Database observability is not configured' });
    return;
  }
  if (!hasSessionModel()) {
    res.status(503).json({
      error: 'Prisma client is outdated. Run `pnpm run prisma:generate` and restart server.',
    });
    return;
  }

  const input = req.body && typeof req.body === 'object' ? req.body : null;
  if (!input) {
    res.status(400).json({ error: 'Invalid event payload' });
    return;
  }

  const source = String(input.source ?? 'unknown');
  const eventType = String(input.eventType ?? input.type ?? 'event');
  const status = input.status ? String(input.status) : null;
  const toolName = input.toolName ? String(input.toolName) : null;
  const sessionId =
    input.sessionId && String(input.sessionId).trim().length > 0
      ? String(input.sessionId)
      : `session_${String(input.roomName ?? 'unknown')}`;
  const roomName = input.roomName ? String(input.roomName) : null;
  const durationMs = Number.isFinite(input.durationMs) ? Math.round(input.durationMs) : null;
  const now = new Date();

  const turn = {
    ts: now.toISOString(),
    source: String(input.source ?? 'unknown'),
    eventType,
    toolName,
    status,
    durationMs,
    payload: input.payload ?? input,
  };

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.agentObservabilitySession.findUnique({
        where: { sessionId },
      });

      if (!existing) {
        const isToolCall = source === 'tool' && eventType === 'tool_execution' && status !== null;
        const isToolError = source === 'tool' && status === 'error';
        const isMetrics = eventType === 'metrics_collected';
        const toolUsageByName = updateToolUsageByName(
          {},
          { source, eventType, toolName, status, durationMs },
        );
        await tx.agentObservabilitySession.create({
          data: {
            sessionId,
            roomName,
            source,
            startedAt: eventType === 'session_started' ? now : null,
            endedAt: eventType === 'session_closed' ? now : null,
            status: status ?? null,
            eventCount: 1,
            toolCalls: isToolCall ? 1 : 0,
            toolErrors: isToolError ? 1 : 0,
            metricsCount: isMetrics ? 1 : 0,
            durationMs,
            summary: {
              lastEventType: eventType,
              lastEventAt: now.toISOString(),
              lastStatus: status,
              toolUsageByName,
              usageSummary:
                eventType === 'session_closed' ? (input.payload?.usageSummary ?? null) : null,
            },
            turns: [turn],
          },
        });
        return;
      }

      const existingTurns = normalizeTurns(existing.turns);
      const mergedTurns = [...existingTurns, turn];
      const cappedTurns =
        mergedTurns.length > MAX_SESSION_TURNS
          ? mergedTurns.slice(mergedTurns.length - MAX_SESSION_TURNS)
          : mergedTurns;

      const isToolCall = source === 'tool' && eventType === 'tool_execution' && status !== null;
      const isToolError = source === 'tool' && status === 'error';
      const isMetrics = eventType === 'metrics_collected';
      const existingSummary =
        existing.summary && typeof existing.summary === 'object' ? existing.summary : {};
      const toolUsageByName = updateToolUsageByName(
        existingSummary,
        { source, eventType, toolName, status, durationMs },
      );

      await tx.agentObservabilitySession.update({
        where: { sessionId },
        data: {
          roomName: roomName ?? existing.roomName,
          source: source ?? existing.source,
          startedAt:
            existing.startedAt ?? (eventType === 'session_started' ? now : existing.startedAt),
          endedAt: eventType === 'session_closed' ? now : existing.endedAt,
          status: status ?? existing.status,
          eventCount: { increment: 1 },
          toolCalls: isToolCall ? { increment: 1 } : undefined,
          toolErrors: isToolError ? { increment: 1 } : undefined,
          metricsCount: isMetrics ? { increment: 1 } : undefined,
          durationMs: durationMs ?? existing.durationMs,
          summary: {
            ...existingSummary,
            lastEventType: eventType,
            lastEventAt: now.toISOString(),
            lastStatus: status ?? existing.status ?? null,
            toolUsageByName,
            usageSummary:
              eventType === 'session_closed'
                ? (input.payload?.usageSummary ?? existingSummary.usageSummary ?? null)
                : (existingSummary.usageSummary ?? null),
          },
          turns: cappedTurns,
        },
      });
    });
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Failed to ingest observability event:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown ingest error',
    });
  }
});

app.get('/observability/sessions', requireDashboardAuth, async (req, res) => {
  if (!hasDatabaseConfig()) {
    res.status(503).json({ error: 'Database observability is not configured' });
    return;
  }
  if (!hasSessionModel()) {
    res.status(503).json({
      error: 'Prisma client is outdated. Run `pnpm run prisma:generate` and restart server.',
    });
    return;
  }

  const limit = clampInt(req.query.limit, 100, 1, 500);
  const where = {};
  if (req.query.source) where.source = String(req.query.source);
  if (req.query.status) where.status = String(req.query.status);
  if (req.query.roomName) where.roomName = String(req.query.roomName);
  if (req.query.sessionId) where.sessionId = String(req.query.sessionId);
  const sinceIso = toIsoDate(req.query.since);
  if (sinceIso) where.updatedAt = { gte: new Date(sinceIso) };

  try {
    const rows = await prisma.agentObservabilitySession.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    res.json({
      sessions: rows.map((row) => {
        const session = toApiSession(row);
        return { ...session, turns: undefined };
      }),
    });
  } catch (error) {
    console.error('Failed to fetch observability sessions:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown query error',
    });
  }
});

app.get('/observability/sessions/:sessionId', requireDashboardAuth, async (req, res) => {
  if (!hasDatabaseConfig()) {
    res.status(503).json({ error: 'Database observability is not configured' });
    return;
  }
  if (!hasSessionModel()) {
    res.status(503).json({
      error: 'Prisma client is outdated. Run `pnpm run prisma:generate` and restart server.',
    });
    return;
  }

  try {
    const row = await prisma.agentObservabilitySession.findUnique({
      where: { sessionId: String(req.params.sessionId) },
    });
    if (!row) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const session = toApiSession(row);
    let turns = normalizeTurns(session.turns);
    if (req.query.eventType) {
      turns = turns.filter((turn) => String(turn.eventType) === String(req.query.eventType));
    }
    if (req.query.toolName) {
      turns = turns.filter((turn) => String(turn.toolName) === String(req.query.toolName));
    }
    if (req.query.status) {
      turns = turns.filter((turn) => String(turn.status) === String(req.query.status));
    }
    res.json({ session: { ...session, turns } });
  } catch (error) {
    console.error('Failed to fetch observability session detail:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown session detail error',
    });
  }
});

app.get('/observability/events', requireDashboardAuth, async (req, res) => {
  const sessionId = req.query.sessionId ? String(req.query.sessionId) : null;
  if (!sessionId) {
    res.status(400).json({ error: 'Use /observability/sessions for session list or pass sessionId' });
    return;
  }
  if (!hasDatabaseConfig()) {
    res.status(503).json({ error: 'Database observability is not configured' });
    return;
  }
  if (!hasSessionModel()) {
    res.status(503).json({
      error: 'Prisma client is outdated. Run `pnpm run prisma:generate` and restart server.',
    });
    return;
  }
  try {
    const row = await prisma.agentObservabilitySession.findUnique({ where: { sessionId } });
    if (!row) {
      res.json({ events: [] });
      return;
    }
    const turns = normalizeTurns(row.turns);
    res.json({ events: turns });
  } catch (error) {
    console.error('Failed to fetch observability events:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown query error',
    });
  }
});

app.get('/observability/summary', requireDashboardAuth, async (req, res) => {
  if (!hasDatabaseConfig()) {
    res.status(503).json({ error: 'Database observability is not configured' });
    return;
  }
  if (!hasSessionModel()) {
    res.status(503).json({
      error: 'Prisma client is outdated. Run `pnpm run prisma:generate` and restart server.',
    });
    return;
  }

  const limit = clampInt(req.query.limit, 1000, 1, 5000);

  try {
    const sessions = await prisma.agentObservabilitySession.findMany({
      select: {
        updatedAt: true,
        eventCount: true,
        metricsCount: true,
        toolCalls: true,
        toolErrors: true,
        status: true,
        durationMs: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });

    const now = Date.now();
    const hourAgoMs = now - 60 * 60 * 1000;
    const sessionDurationValues = [];
    let sessionsLastHour = 0;
    let totalTurns = 0;
    let totalToolCalls = 0;
    let totalToolErrors = 0;
    let totalMetrics = 0;
    let endedSessions = 0;
    let errorSessions = 0;

    for (const session of sessions) {
      const updatedAtMs = new Date(session.updatedAt).getTime();
      if (Number.isFinite(updatedAtMs) && updatedAtMs >= hourAgoMs) {
        sessionsLastHour += 1;
      }
      totalTurns += Number(session.eventCount ?? 0);
      totalMetrics += Number(session.metricsCount ?? 0);
      totalToolCalls += Number(session.toolCalls ?? 0);
      totalToolErrors += Number(session.toolErrors ?? 0);
      if (session.status === 'error') errorSessions += 1;
      if (Number.isFinite(session.durationMs)) {
        sessionDurationValues.push(Number(session.durationMs));
        endedSessions += 1;
      }
    }

    const avgDurationMs = sessionDurationValues.length
      ? Math.round(sessionDurationValues.reduce((a, b) => a + b, 0) / sessionDurationValues.length)
      : 0;

    res.json({
      totalSessions: sessions.length,
      sessionsLastHour,
      totalTurns,
      totalMetrics,
      endedSessions,
      errorSessions,
      totalToolCalls,
      totalToolErrors,
      toolSuccessRate: totalToolCalls
        ? Number(((totalToolCalls - totalToolErrors) / totalToolCalls).toFixed(4))
        : 0,
      sessionDuration: {
        avgMs: avgDurationMs,
        p95Ms: Math.round(percentile(sessionDurationValues, 95)),
      },
    });
  } catch (error) {
    console.error('Failed to build observability summary:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown summary error',
    });
  }
});

// ── SSE: track connected browser clients ─────────────────────
const sseClients = new Set();

app.get('/widgets', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write('retry: 1000\n\n');

  sseClients.add(res);
  console.log(`[SSE] Client connected (${sseClients.size} total)`);

  req.on('close', () => {
    sseClients.delete(res);
    console.log(`[SSE] Client disconnected (${sseClients.size} remaining)`);
  });
});

app.post('/widgets', (req, res) => {
  const msg = JSON.stringify(req.body);
  for (const client of sseClients) {
    client.write(`data: ${msg}\n\n`);
  }
  console.log(`[SSE] Broadcasted to ${sseClients.size} client(s):`, msg);
  res.json({ status: 'ok', clients: sseClients.size });
});

// ── LiveKit token ─────────────────────────────────────────────
app.post('/token', async (req, res) => {
  const { identity = 'user' } = req.body;
  const roomName = `room_${Math.random().toString(36).substring(2, 9)}`;

  const at = new AccessToken(API_KEY, API_SECRET, { identity });
  at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });

  const token = await at.toJwt();
  res.json({ token, serverUrl: LIVEKIT_URL, roomName });
});

app.listen(PORT, () => console.log(`Web server on http://localhost:${PORT}`));

process.on('SIGINT', async () => {
  if (prisma) await prisma.$disconnect();
  process.exit(0);
});
