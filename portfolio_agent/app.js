import { Room } from 'https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.esm.mjs';

import { initUI } from './js/ui.js';
import { initLivekit } from './js/livekit.js';

// Create LiveKit room once and share everywhere
const room = new Room();

// Init UI (orb/bg/freq/ticker/state/buttons)
const ui = initUI({ room });

// Init LiveKit + widget plumbing (uses ui + room)
initLivekit({ room, ui });