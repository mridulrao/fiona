import { RoomEvent, Track } from 'https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.esm.mjs';

import {
  cardAbout,
  cardProjects,
  cardSkills,
  cardExperience,
  cardContact,
  cardLinkedin,
} from '../js/cards.js';

export function initLivekit({ room, ui }) {
  const { btnStart, btnMic, btnDisc, sTxt } = ui.els;
  let roomListenersBound = false;
  let audioContext = null;
  let sessionActive = false;
  let audioLoopEpoch = 0;
  const remoteAudioEls = new Map();
  const apiBaseUrl = window.location.origin;

  /* ─────────────────────────────────────────────────────────────
     GET USER INPUT WIDGET (modal)
  ───────────────────────────────────────────────────────────── */
  const formModal     = document.getElementById('form-modal');
  const formXBtn      = document.getElementById('form-x');
  const formCancelBtn = document.getElementById('form-cancel');
  const formSubmitBtn = document.getElementById('form-submit');

  let activeRequestId = null;

  function openFormWidget(msg) {
    // If targeted to a specific identity, only show to that participant
    if (msg.identity && room?.localParticipant?.identity && msg.identity !== room.localParticipant.identity) return;
    if (!msg.requestId) return;

    activeRequestId = msg.requestId;

    document.getElementById('fi-name').value    = '';
    document.getElementById('fi-contact').value = '';
    document.getElementById('fi-message').value = '';

    formModal.classList.add('on');
    formModal.setAttribute('aria-hidden', 'false');
    document.getElementById('fi-name').focus();
  }

  function closeFormWidget() {
    formModal.classList.remove('on');
    formModal.setAttribute('aria-hidden', 'true');
    activeRequestId = null;
  }

  async function publishToRoom(obj) {
    const encoded = new TextEncoder().encode(JSON.stringify(obj));
    await room.localParticipant.publishData(encoded, { reliable: true });
  }

  function validateAndCollect() {
    const name    = document.getElementById('fi-name').value.trim();
    const contact = document.getElementById('fi-contact').value.trim();
    const message = document.getElementById('fi-message').value.trim();

    let valid = true;
    for (const [id, val] of [['fi-name', name], ['fi-contact', contact]]) {
      const el = document.getElementById(id);
      if (!val) {
        el.style.borderColor = 'rgba(255,0,110,0.6)';
        setTimeout(() => { el.style.borderColor = ''; }, 700);
        if (valid) el.focus();
        valid = false;
      }
    }
    if (!valid) return null;
    return { name, contact, message };
  }

  formSubmitBtn.onclick = async () => {
    if (!activeRequestId) return;
    const values = validateAndCollect();
    if (!values) return;

    await publishToRoom({
      type:      'YUKI_GETUSERINPUT_RESULT',
      requestId: activeRequestId,
      values,
      ts:        Date.now(),
    });

    closeFormWidget();
  };

  async function cancelForm() {
    if (!activeRequestId) return;

    await publishToRoom({
      type:      'YUKI_GETUSERINPUT_CANCEL',
      requestId: activeRequestId,
      ts:        Date.now(),
    });

    closeFormWidget();
  }

  formCancelBtn.onclick = cancelForm;
  formXBtn.onclick      = cancelForm;

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && formModal.classList.contains('on')) cancelForm();
  });

  /* ── Widget dispatcher ─────────────────────────────────────── */
  function dispatch(msg) {
    switch (msg.widget) {
      case 'about':        cardAbout();           break;
      case 'projects':     cardProjects(msg);     break;
      case 'skills':       cardSkills(msg);       break;
      case 'experience':   cardExperience(msg);   break;
      case 'contact':      cardContact();         break;
      case 'linkedin':     cardLinkedin();        break;
      case 'getuserinput': openFormWidget(msg);   break;
      default: console.warn('[YUKI] Unknown widget:', msg.widget);
    }
  }

  /* ── BroadcastChannel from test panel ───────────────────────── */
  const bc = new BroadcastChannel('YUKI_WIDGETS');
  bc.onmessage = (e) => { if (e.data?.type === 'YUKI_WIDGET') dispatch(e.data); };

  /* ── SSE widgets feed ──────────────────────────────────────── */
  const sse = new EventSource(`${apiBaseUrl}/widgets`);
  sse.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg?.type === 'YUKI_WIDGET') dispatch(msg);
    } catch (err) {
      console.error('[SSE] Parse error:', err);
    }
  };
  sse.onerror = () => console.warn('[SSE] Not reachable — is server.js running?');

  /* ── LiveKit data messages ──────────────────────────────────── */
  function onData(payload) {
    let msg;
    try { msg = JSON.parse(new TextDecoder().decode(payload)); } catch { return; }

    if (msg?.type === 'YUKI_WIDGET') dispatch(msg);

    if (msg?.type === 'TRANSCRIPT') {
      const isUser = msg.role === 'user';
      console.log(
        `%c${isUser ? '🎙 USER' : '🤖 YUKI'}  %c${msg.text}`,
        `color: ${isUser ? '#00ffe7' : '#ff006e'}; font-weight: bold`,
        'color: inherit; font-weight: normal'
      );
    }
  }

  function bindRoomListeners() {
    if (roomListenersBound) return;
    roomListenersBound = true;

    room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
      console.log('Data received:', { participant: participant?.identity, topic, kind });
      onData(payload);
    });

    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return;
      const loopEpoch = audioLoopEpoch;

      const el = track.attach();
      el.autoplay = true;
      el.playsInline = true;
      el.muted = false;
      el.volume = 1;
      el.style.display = 'none';
      document.body.appendChild(el);
      remoteAudioEls.set(track.sid, el);

      // Explicitly call play to avoid intermittent autoplay policy failures.
      el.play().catch((err) => {
        console.warn('[Audio] Autoplay blocked; waiting for next user gesture.', err);
        sTxt.textContent = 'AUDIO BLOCKED BY BROWSER. CLICK CONNECT AGAIN.';
      });

      try {
        if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});

        const src = audioContext.createMediaStreamSource(
          el.srcObject || new MediaStream([track.mediaStreamTrack])
        );
        const an = audioContext.createAnalyser();
        an.fftSize = 256;
        src.connect(an);

        const d = new Uint8Array(an.frequencyBinCount);
        let tmr;

        const chk = () => {
          if (!sessionActive || loopEpoch !== audioLoopEpoch) return;
          an.getByteFrequencyData(d);
          const avg = d.reduce((a, b) => a + b, 0) / d.length;

          if (avg > 5 && ui.appState !== 'muted') {
            clearTimeout(tmr);
            if (ui.appState !== 'speaking') ui.setState('speaking', 'AGENT TRANSMITTING...');
            tmr = setTimeout(() => {
              if (ui.appState === 'speaking') ui.setState('listening', 'AWAITING INPUT...');
            }, 600);
          }
          requestAnimationFrame(chk);
        };

        chk();
      } catch {}
    });

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      const el = remoteAudioEls.get(track.sid);
      if (el) {
        try { el.remove(); } catch {}
        remoteAudioEls.delete(track.sid);
      }
    });

    room.on(RoomEvent.LocalTrackPublished, (pub) => {
      if (!sessionActive) return;
      if (pub.kind === Track.Kind.Audio) ui.setState('listening', 'MICROPHONE ACTIVE');
    });

    room.on(RoomEvent.Disconnected, () => {
      sessionActive = false;
      audioLoopEpoch++;
      ui.showBtns('pre');
      ui.setState('idle', 'SESSION TERMINATED');
      btnStart.style.opacity = '1';
      btnStart.style.pointerEvents = '';
    });
  }

  /* ── LiveKit connection ─────────────────────────────────────── */
  async function connect() {
    sTxt.textContent = 'ESTABLISHING CONNECTION...';
    btnStart.style.opacity = '.5';
    btnStart.style.pointerEvents = 'none';

    try {
      // Prime AudioContext on user gesture to improve playback reliability.
      if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') await audioContext.resume();

      const { token, serverUrl, roomName } = await fetch(`${apiBaseUrl}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: 'user_' + Math.random().toString(36).slice(2, 6) })
      }).then(r => r.json());

      bindRoomListeners();

      sessionActive = true;
      audioLoopEpoch++;
      await room.connect(serverUrl, token);
      await room.localParticipant.setMicrophoneEnabled(true);

      ui.showBtns('post');
      ui.setState('connected', `ROOM: ${roomName}`);
      ui.updMic();

    } catch (e) {
      sessionActive = false;
      sTxt.textContent = 'CONNECTION FAILED: ' + (e?.message || e);
      btnStart.style.opacity = '1';
      btnStart.style.pointerEvents = '';
    }
  }

  function disconnect() {
    sessionActive = false;
    audioLoopEpoch++;
    room.disconnect();
    for (const el of remoteAudioEls.values()) {
      try { el.remove(); } catch {}
    }
    remoteAudioEls.clear();
    ui.showBtns('pre');
    ui.setState('idle', 'SESSION TERMINATED');
    btnStart.style.opacity = '1';
    btnStart.style.pointerEvents = '';
  }

  function toggleMic() {
    const on = room.localParticipant.isMicrophoneEnabled;
    room.localParticipant.setMicrophoneEnabled(!on);
    ui.updMic();
    ui.setState(on ? 'muted' : 'listening', on ? 'INPUT SUSPENDED' : 'MICROPHONE ACTIVE');
  }

  // Wire UI buttons
  btnStart.onclick = connect;
  btnDisc.onclick  = disconnect;
  btnMic.onclick   = toggleMic;
}
