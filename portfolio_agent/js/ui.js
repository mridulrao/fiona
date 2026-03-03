export function initUI({ room }) {
  let appState = 'idle';

  /* ── Background particles ─────────────────────────────────── */
  const bgC = document.getElementById('bg-canvas');
  const bgX = bgC.getContext('2d');
  let pts = [];

  const rsB = () => { bgC.width = innerWidth; bgC.height = innerHeight; };
  rsB();

  for (let i = 0; i < 70; i++) {
    pts.push({
      x: Math.random() * innerWidth,
      y: Math.random() * innerHeight,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      sz: Math.random() * 1.5 + 0.3,
      a: Math.random() * 0.3 + 0.08
    });
  }

  function drawBg() {
    bgX.clearRect(0, 0, bgC.width, bgC.height);
    pts.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = bgC.width;
      if (p.x > bgC.width) p.x = 0;
      if (p.y < 0) p.y = bgC.height;
      if (p.y > bgC.height) p.y = 0;

      bgX.beginPath();
      bgX.arc(p.x, p.y, p.sz, 0, Math.PI * 2);
      bgX.fillStyle = `rgba(22,22,24,${p.a * 0.45})`;
      bgX.fill();
    });

    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x;
      const dy = pts[i].y - pts[j].y;
      const d = Math.hypot(dx, dy);
      if (d < 90) {
        bgX.beginPath();
        bgX.moveTo(pts[i].x, pts[i].y);
        bgX.lineTo(pts[j].x, pts[j].y);
        bgX.strokeStyle = `rgba(24,24,28,${0.08 * (1 - d / 90)})`;
        bgX.lineWidth = 0.5;
        bgX.stroke();
      }
    }
  }

  /* ── Orb ──────────────────────────────────────────────────── */
  const oC = document.getElementById('orb-canvas');
  const oX = oC.getContext('2d');
  let W, H, CX, CY, R;

  function rsO() {
    const s = oC.parentElement.offsetWidth;
    oC.width = s; oC.height = s;
    W = H = s;
    CX = CY = s / 2;
    R = s * 0.36;
  }
  rsO();

  function drawOrb(t) {
    oX.clearRect(0, 0, W, H);
    if (appState === 'listening') drawListen(t);
    else if (appState === 'speaking') drawSpeak(t);
    else if (appState === 'muted') drawMuted(t);
    else drawIdle(t);
  }

  function drawIdle(t) {
    const ts = t * 0.0005;
    oX.beginPath();
    oX.arc(CX, CY, R, 0, Math.PI * 2);
    oX.strokeStyle = 'rgba(35,35,40,.24)';
    oX.lineWidth = 1;
    oX.stroke();

    oX.save();
    oX.translate(CX, CY);
    oX.rotate(ts);
    oX.beginPath();
    oX.arc(0, 0, R * 0.88, 0, Math.PI * 2);
    oX.setLineDash([4, 12]);
    oX.strokeStyle = 'rgba(35,35,40,.2)';
    oX.lineWidth = 1;
    oX.stroke();
    oX.setLineDash([]);
    oX.restore();

    const g = oX.createRadialGradient(CX, CY, 0, CX, CY, R * 0.38);
    g.addColorStop(0, 'rgba(35,35,40,.08)');
    g.addColorStop(1, 'transparent');
    oX.beginPath();
    oX.arc(CX, CY, R * 0.38, 0, Math.PI * 2);
    oX.fillStyle = g;
    oX.fill();

    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + ts;
      const l = i % 6 === 0 ? R * 0.1 : R * 0.05;
      oX.beginPath();
      oX.moveTo(CX + Math.cos(a) * R, CY + Math.sin(a) * R);
      oX.lineTo(CX + Math.cos(a) * (R - l), CY + Math.sin(a) * (R - l));
      oX.strokeStyle = i % 6 === 0 ? 'rgba(20,20,24,.4)' : 'rgba(35,35,40,.15)';
      oX.lineWidth = 1;
      oX.stroke();
    }
  }

  function drawMuted(t) {
    const ts = t * 0.0003;
    oX.beginPath();
    oX.arc(CX, CY, R, 0, Math.PI * 2);
    oX.strokeStyle = 'rgba(90,90,96,.25)';
    oX.lineWidth = 1;
    oX.stroke();

    oX.save();
    oX.translate(CX, CY);
    oX.rotate(-ts * 0.5);
    oX.beginPath();
    oX.arc(0, 0, R * 0.82, 0, Math.PI * 2);
    oX.setLineDash([3, 16]);
    oX.strokeStyle = 'rgba(90,90,96,.2)';
    oX.lineWidth = 1;
    oX.stroke();
    oX.setLineDash([]);
    oX.restore();

    for (let i = 0; i < 38; i++) {
      const seed = Math.floor(t * 0.008);
      const nx = CX + (Math.sin(i * 137.5 + seed) * 0.5) * R * 0.75;
      const ny = CY + (Math.cos(i * 97.3 + seed) * 0.5) * R * 0.75;
      const a = (Math.sin(i + t * 0.003) * 0.5 + 0.5) * 0.3;
      oX.beginPath();
      oX.arc(nx, ny, 1, 0, Math.PI * 2);
      oX.fillStyle = `rgba(95,95,104,${a})`;
      oX.fill();
    }

    const s = R * 0.22;
    oX.save();
    oX.translate(CX, CY);
    oX.strokeStyle = '#6f7076';
    oX.lineWidth = 2.5;
    oX.shadowColor = '#6f7076';
    oX.shadowBlur = 14;
    oX.beginPath(); oX.moveTo(-s, -s); oX.lineTo(s, s); oX.stroke();
    oX.beginPath(); oX.moveTo(s, -s); oX.lineTo(-s, s); oX.stroke();
    oX.shadowBlur = 0;
    oX.restore();
  }

  function drawListen(t) {
    const ts = t * 0.002;

    const g = oX.createRadialGradient(CX, CY, R * 0.85, CX, CY, R * 1.15);
    g.addColorStop(0, 'rgba(30,30,35,.1)');
    g.addColorStop(1, 'transparent');
    oX.beginPath();
    oX.arc(CX, CY, R * 1.15, 0, Math.PI * 2);
    oX.fillStyle = g;
    oX.fill();

    oX.beginPath();
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const n =
        Math.sin(a * 3 + ts) * R * 0.12 +
        Math.sin(a * 7 - ts * 1.3) * R * 0.06 +
        Math.sin(a * 13 + ts * 0.7) * R * 0.03;
      const r = (R * 0.78) + n;
      if (i === 0) oX.moveTo(CX + Math.cos(a) * r, CY + Math.sin(a) * r);
      else oX.lineTo(CX + Math.cos(a) * r, CY + Math.sin(a) * r);
    }
    oX.closePath();
    oX.strokeStyle = '#202024';
    oX.lineWidth = 1.5;
    oX.shadowColor = '#202024';
    oX.shadowBlur = 12;
    oX.stroke();
    oX.shadowBlur = 0;

    const ig = oX.createRadialGradient(CX, CY, 0, CX, CY, R * 0.78);
    ig.addColorStop(0, 'rgba(30,30,35,.06)');
    ig.addColorStop(1, 'transparent');
    oX.fillStyle = ig;
    oX.fill();

    oX.save();
    oX.translate(CX, CY);
    oX.rotate(ts * 2);
    const sg = oX.createLinearGradient(0, 0, R * 0.78, 0);
    sg.addColorStop(0, 'rgba(22,22,24,.55)');
    sg.addColorStop(1, 'rgba(22,22,24,0)');
    oX.beginPath();
    oX.moveTo(0, 0);
    oX.lineTo(R * 0.78, 0);
    oX.strokeStyle = sg;
    oX.lineWidth = 2;
    oX.stroke();
    oX.restore();
  }

  function drawSpeak(t) {
    const ts = t * 0.001;

    for (let l = 0; l < 3; l++) {
      oX.beginPath();
      for (let i = 0; i <= 180; i++) {
        const a = (i / 180) * Math.PI * 2;
        const ph = ts * (1 + l * 0.3);
        const n =
          Math.sin(a * (4 + l) + ph) * (R * 0.18 - l * R * 0.04) +
          Math.sin(a * (9 + l * 2) - ph * 1.7) * (R * 0.08 - l * R * 0.02) +
          Math.sin(a * 17 + ph * 2.1 + l) * R * 0.04;
        const r = (R * 0.95) + n;
        if (i === 0) oX.moveTo(CX + Math.cos(a) * r, CY + Math.sin(a) * r);
        else oX.lineTo(CX + Math.cos(a) * r, CY + Math.sin(a) * r);
      }
      oX.closePath();
      const c = ['#2f2f31', '#5b5c62', '#8a8b92'][l];
      oX.strokeStyle = c;
      oX.lineWidth = 2 - l * 0.5;
      oX.shadowColor = c;
      oX.shadowBlur = 15 - l * 3;
      oX.stroke();
      oX.shadowBlur = 0;
    }

    oX.save();
    oX.beginPath();
    oX.arc(CX, CY, R * 0.72, 0, Math.PI * 2);
    oX.clip();

    const gs = R * 0.16;
    for (let gx = CX - R; gx <= CX + R; gx += gs) for (let gy = CY - R; gy <= CY + R; gy += gs) {
      const dx = gx - CX, dy = gy - CY;
      const d = Math.hypot(dx, dy);
      const w = Math.sin(d * 0.1 - ts * 6) * 0.5 + 0.5;
      if (w > 0.6) {
        oX.beginPath();
        oX.arc(gx, gy, 1.5, 0, Math.PI * 2);
        oX.fillStyle = `rgba(42,42,48,${w * 0.35})`;
        oX.fill();
      }
    }
    oX.restore();

    const pulse = Math.sin(ts * 8) * 0.5 + 0.5;
    const cg = oX.createRadialGradient(CX, CY, 0, CX, CY, R * 0.35 + pulse * R * 0.1);
    cg.addColorStop(0, `rgba(40,40,46,${0.24 + pulse * 0.16})`);
    cg.addColorStop(0.5, `rgba(100,100,108,${0.08 + pulse * 0.08})`);
    cg.addColorStop(1, 'transparent');

    oX.beginPath();
    oX.arc(CX, CY, R * 0.4 + pulse * R * 0.1, 0, Math.PI * 2);
    oX.fillStyle = cg;
    oX.fill();
  }

  function loop(t) {
    drawBg(t);
    drawOrb(t);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Resize handling
  addEventListener('resize', () => { rsB(); rsO(); });

  /* ── Freq bars ─────────────────────────────────────────────── */
  const fbEl = document.getElementById('freq-bars');
  for (let i = 0; i < 20; i++) {
    const b = document.createElement('div');
    b.className = 'fbar';
    b.style.setProperty('--h', (Math.random() * 28 + 6) + 'px');
    b.style.animationDelay = (i * 0.05) + 's';
    b.style.animationDuration = (0.4 + Math.random() * 0.5) + 's';
    fbEl.appendChild(b);
  }

  /* ── Ticker ────────────────────────────────────────────────── */
  const tkEl = document.getElementById('ticker');
  const TICKS = [
    'SIGNAL: ████████░░ 82%',
    'LATENCY: 24ms // CODEC: OPUS',
    'CHANNEL: ENCRYPTED',
    'AUDIO: 48kHz 16-BIT'
  ];
  let tki = 0;
  const tick = () => { tkEl.textContent = TICKS[tki++ % TICKS.length]; };

  /* ── State machine ─────────────────────────────────────────── */
  const sInd  = document.getElementById('s-ind');
  const sMode = document.getElementById('s-mode');
  const sTxt  = document.getElementById('s-text');
  const oLbl  = document.getElementById('orb-label');

  function setState(st, msg) {
    appState = st;
    sInd.className = 's-ind';
    fbEl.classList.remove('on');
    tkEl.classList.remove('on');
    fbEl.querySelectorAll('.fbar').forEach(b => b.classList.remove('muted'));

    const fns = {
      listening: () => {
        sInd.classList.add('active');
        sMode.textContent = 'LISTENING';
        oLbl.textContent  = 'RECEIVING';
        oLbl.style.color  = 'var(--cyan)';
        fbEl.classList.add('on');
        fbEl.querySelectorAll('.fbar').forEach(b => b.style.setProperty('--h', (Math.random() * 28 + 6) + 'px'));
      },
      speaking: () => {
        sInd.classList.add('speaking');
        sMode.textContent = 'TRANSMITTING';
        oLbl.textContent  = 'PROCESSING';
        oLbl.style.color  = 'var(--magenta)';
        tkEl.classList.add('on');
        tick();
      },
      muted: () => {
        sInd.classList.add('muted');
        sMode.textContent = 'MIC OFF';
        oLbl.textContent  = 'MUTED';
        oLbl.style.color  = 'var(--amber)';
        fbEl.classList.add('on');
        fbEl.querySelectorAll('.fbar').forEach(b => b.classList.add('muted'));
      },
      connected: () => {
        sInd.classList.add('active');
        sMode.textContent = 'CONNECTED';
        oLbl.textContent  = 'STANDBY';
        oLbl.style.color  = 'var(--cyan)';
      },
      idle: () => {
        sMode.textContent = 'OFFLINE';
        oLbl.textContent  = 'STANDBY';
        oLbl.style.color  = 'var(--cyan)';
      }
    };

    (fns[st] || fns.idle)();
    if (msg) sTxt.textContent = msg;
  }

  /* ── Buttons helpers ───────────────────────────────────────── */
  const btnStart = document.getElementById('btn-start');
  const btnMic   = document.getElementById('btn-mic');
  const btnDisc  = document.getElementById('btn-disc');

  const showBtns = (phase) => {
    btnStart.classList.toggle('hide', phase !== 'pre');
    btnMic.classList.toggle('hide', phase === 'pre');
    btnDisc.classList.toggle('hide', phase === 'pre');
  };

  const updMic = () => {
    btnMic.textContent = room.localParticipant.isMicrophoneEnabled ? 'MUTE' : 'UNMUTE';
  };

  // Speaking animation ticker refresh (same behavior as original)
  setInterval(() => {
    if (appState === 'speaking') {
      tick();
      fbEl.querySelectorAll('.fbar').forEach(b => b.style.setProperty('--h', (Math.random() * 28 + 6) + 'px'));
    }
  }, 1800);

  // Initial state
  showBtns('pre');

  return {
    // expose only what other modules need
    els: { btnStart, btnMic, btnDisc, sTxt },
    setState,
    showBtns,
    updMic,
    tick,
    get appState() { return appState; },
  };
}
