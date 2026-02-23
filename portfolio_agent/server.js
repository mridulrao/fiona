import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import express from 'express';
import { AccessToken } from 'livekit-server-sdk';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const LIVEKIT_URL    = process.env.LIVEKIT_URL;
const API_KEY        = process.env.LIVEKIT_API_KEY;
const API_SECRET     = process.env.LIVEKIT_API_SECRET;

console.log('LIVEKIT_URL:', LIVEKIT_URL);
console.log('LIVEKIT_API_KEY set?', !!API_KEY);
console.log('LIVEKIT_API_SECRET set?', !!API_SECRET);

// ── SSE: track connected browser clients ─────────────────────
const sseClients = new Set();

// Browser subscribes here
app.get('/widgets', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.write('retry: 1000\n\n');

  sseClients.add(res);
  console.log(`[SSE] Client connected (${sseClients.size} total)`);

  req.on('close', () => {
    sseClients.delete(res);
    console.log(`[SSE] Client disconnected (${sseClients.size} remaining)`);
  });
});

// Node agent POSTs widget events here
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

app.listen(3001, () => console.log('Token server on http://localhost:3001'));