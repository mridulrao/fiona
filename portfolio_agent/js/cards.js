const stack = document.getElementById('card-stack');

const ME = {
  name:     'Mridul Rao',
  role:     'Software Engineer · AI & Automation',
  bio:      'Building voice agents, RAG pipelines, and enterprise AI systems.',
  photo:    'https://github.com/mridulrao.png',
  github:   'https://github.com/mridulrao',
  linkedin: 'https://www.linkedin.com/in/mridul-rao/',
  medium:   'https://medium.com/@mridulrao674385',
  email:    'mridulrao370@gmail.com',
};

const TTL     = 20000;
const TTL_LNG = 24000;

const CARD_W = 294;
const CARD_H = 340;

function getPlacementZones() {
  const vw = innerWidth, vh = innerHeight;
  const cx = vw / 2, cy = vh / 2;
  const safeR = Math.min(vw, vh) * 0.32;

  const pad = 24;
  const zones = [
    { x: pad, y: pad, w: cx - safeR * 0.7 - pad, h: cy - safeR * 0.7 - pad },
    { x: cx + safeR * 0.7, y: pad, w: vw - (cx + safeR * 0.7) - pad, h: cy - safeR * 0.7 - pad },
    { x: pad, y: cy + safeR * 0.7, w: cx - safeR * 0.7 - pad, h: vh - (cy + safeR * 0.7) - pad },
    { x: cx + safeR * 0.7, y: cy + safeR * 0.7, w: vw - (cx + safeR * 0.7) - pad, h: vh - (cy + safeR * 0.7) - pad },
    { x: pad, y: cy - CARD_H / 2, w: cx - safeR * 0.85 - pad, h: CARD_H },
    { x: cx + safeR * 0.85, y: cy - CARD_H / 2, w: vw - (cx + safeR * 0.85) - pad, h: CARD_H },
  ].filter(z => z.w >= CARD_W * 0.7 && z.h >= 80);

  return zones;
}

const placed = [];

function randomPosition() {
  const zones = getPlacementZones();
  if (!zones.length) {
    return {
      left: Math.random() * Math.max(innerWidth  - CARD_W - 32, 32) + 16,
      top:  Math.random() * Math.max(innerHeight - CARD_H - 32, 32) + 16,
    };
  }

  const shuffled = zones.sort(() => Math.random() - 0.5);

  for (const zone of shuffled) {
    const maxX = zone.x + zone.w - CARD_W;
    const maxY = zone.y + zone.h - CARD_H;
    if (maxX < zone.x || maxY < zone.y) continue;

    for (let attempt = 0; attempt < 8; attempt++) {
      const left = zone.x + Math.random() * (maxX - zone.x);
      const top  = zone.y + Math.random() * (maxY - zone.y);

      const gap = 16;
      const overlaps = placed.some(r =>
        left < r.left + r.w + gap &&
        left + CARD_W + gap > r.left &&
        top  < r.top  + r.h + gap &&
        top  + CARD_H + gap > r.top
      );
      if (!overlaps) return { left, top };
    }
  }

  const zone = shuffled[0];
  return {
    left: Math.min(Math.max(zone.x, 16), innerWidth  - CARD_W - 16),
    top:  Math.min(Math.max(zone.y, 16), innerHeight - CARD_H - 16),
  };
}

function killCard(el) {
  if (el._dead) return;
  el._dead = true;
  clearTimeout(el._tid);
  const idx = placed.indexOf(el._rect);
  if (idx !== -1) placed.splice(idx, 1);
  el.classList.add('out');
  setTimeout(() => el.remove(), 360);
}

function makeCard({ id, color, ttl = TTL, typeLabel, bodyHTML }) {
  const old = stack.querySelector(`[data-id="${id}"]`);
  if (old) killCard(old);

  const { left, top } = randomPosition();
  const rect = { left, top, w: CARD_W, h: CARD_H };
  placed.push(rect);

  const bobDur   = (3.2 + Math.random() * 2.4).toFixed(2) + 's';
  const bobDelay = (Math.random() * -3).toFixed(2) + 's';
  const bobAmp   = -(6 + Math.random() * 6).toFixed(1) + 'px';

  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.id = id;
  el.style.cssText = `
    left: ${left}px;
    top:  ${top}px;
    --cc:       ${color};
    --ttl:      ${ttl / 1000}s;
    --bob-dur:  ${bobDur};
    --bob-delay:${bobDelay};
    --bob-amp:  ${bobAmp};
  `;

  el.innerHTML = `
    <div class="card-bar"></div>
    <div class="card-meta">
      <span class="card-type">${typeLabel}</span>
      <button class="card-x">✕</button>
    </div>
    <div class="card-body">${bodyHTML}</div>
    <div class="card-drain"></div>
  `;

  el.querySelector('.card-x').onclick = () => killCard(el);
  el._rect = rect;
  el._tid  = setTimeout(() => killCard(el), ttl);
  stack.appendChild(el);
}

/* ─────────────────────────────────────────────────────────────
   PUBLIC CARD FUNCTIONS
───────────────────────────────────────────────────────────── */

export function cardAbout() {
  makeCard({
    id: 'about',
    color: '#00ffe7',
    ttl: TTL,
    typeLabel: '// ABOUT',
    bodyHTML: `
      <div class="about-row">
        <img class="about-avatar" src="${ME.photo}" alt="${ME.name}"
          onerror="this.style.background='#0d1420'">
        <div>
          <div class="c-title" style="font-size:.68rem">${ME.name}</div>
          <div class="c-sub" style="margin-bottom:0">${ME.role}</div>
        </div>
      </div>
      <p class="about-bio">${ME.bio}</p>`,
  });
}

export function cardProjects({ projects = [], filter = null } = {}) {
  const fl = filter ? filter.toLowerCase() : null;

  const rows = projects.map(p => {
    const isHL = fl && (p.name.toLowerCase().includes(fl) || (p.tags || []).some(t => t.toLowerCase().includes(fl)));
    const tags = (p.tags || []).map(t => {
      const tHL = fl && t.toLowerCase().includes(fl);
      return `<span class="proj-tag${tHL ? ' hl' : ''}">${t}</span>`;
    }).join('');

    return `
      <a class="proj-row${isHL ? ' hl' : ''}" href="${p.url}" target="_blank" rel="noopener">
        <div class="proj-header">
          <span class="proj-name">${p.name}</span>
          <span class="proj-arrow">→</span>
        </div>
        <div class="proj-desc">${p.desc}</div>
        <div class="proj-tags">${tags}</div>
      </a>`;
  }).join('');

  makeCard({
    id: 'projects',
    color: '#00ffe7',
    ttl: TTL_LNG,
    typeLabel: '// PROJECTS',
    bodyHTML: `
      <div class="c-title">Featured Work</div>
      <div class="c-sub">github.com/mridulrao</div>
      ${rows}`,
  });
}

export function cardSkills({ skills = [], highlight = null } = {}) {
  const hl = highlight ? highlight.toLowerCase() : null;

  const groups = skills.map(g => {
    const chips = (g.items || []).map(item => {
      const on = hl && item.toLowerCase().includes(hl);
      return `<span class="chip${on ? ' hl' : ''}">${item}</span>`;
    }).join('');
    const gHL = hl && (g.group || '').toLowerCase().includes(hl);

    return `
      <div class="skill-group">
        <div class="sg-label" style="${gHL ? 'color:var(--cc)' : ''}">${g.group}</div>
        <div class="sg-chips">${chips}</div>
      </div>`;
  }).join('');

  makeCard({
    id: 'skills',
    color: '#a78bfa',
    ttl: TTL,
    typeLabel: '// SKILLS',
    bodyHTML: `
      <div class="c-title">Tech Stack</div>
      <div class="c-sub" style="margin-bottom:10px">Languages · AI/ML · Infrastructure · Platforms</div>
      ${groups}`,
  });
}

// kept as-is from your original (even if styles for exp-entry aren’t in CSS)
export function cardExperience({ experience = [] } = {}) {
  const entries = experience.map(e => `
    <div class="exp-entry">
      <div class="exp-role">${e.role}</div>
      <div class="exp-company">${e.company}</div>
      <div class="exp-period">${e.period}</div>
      <ul class="exp-bullets">
        ${(e.bullets || []).map(b => `<li>${b}</li>`).join('')}
      </ul>
    </div>`).join('');

  makeCard({
    id: 'experience',
    color: '#fb923c',
    ttl: TTL_LNG,
    typeLabel: '// EXPERIENCE',
    bodyHTML: `
      <div class="c-title">Work History</div>
      <div class="c-sub" style="margin-bottom:10px">Career timeline</div>
      ${entries}`,
  });
}

export function cardContact() {
  makeCard({
    id: 'contact',
    color: '#ffb700',
    ttl: TTL_LNG,
    typeLabel: '// CONTACT',
    bodyHTML: `
      <div class="c-title">Get in Touch</div>
      <div class="c-sub" style="margin-bottom:4px">Reach out anytime</div>
      <a class="link-row" href="${ME.github}" target="_blank" rel="noopener">
        <span class="lr-icon">⬡</span>
        <span class="lr-text"><div class="lr-label">GITHUB</div><div class="lr-val">github.com/mridulrao</div></span>
        <span class="lr-arrow">→</span>
      </a>
      <a class="link-row" href="${ME.linkedin}" target="_blank" rel="noopener">
        <span class="lr-icon">💼</span>
        <span class="lr-text"><div class="lr-label">LINKEDIN</div><div class="lr-val">linkedin.com/in/mridulrao</div></span>
        <span class="lr-arrow">→</span>
      </a>
      <a class="link-row" href="${ME.medium}" target="_blank" rel="noopener">
        <span class="lr-icon">💼</span>
        <span class="lr-text"><div class="lr-label">MEDIUM</div><div class="lr-val">medium.com/@mridulrao674385</div></span>
        <span class="lr-arrow">→</span>
      </a>
      <a class="link-row" href="mailto:${ME.email}">
        <span class="lr-icon">✉</span>
        <span class="lr-text"><div class="lr-label">EMAIL</div><div class="lr-val">${ME.email}</div></span>
        <span class="lr-arrow">→</span>
      </a>`,
  });
}

export function cardLinkedin() {
  makeCard({
    id: 'linkedin',
    color: '#4fa3e0',
    ttl: TTL,
    typeLabel: '// LINKEDIN',
    bodyHTML: `
      <div class="c-title">${ME.name}</div>
      <div class="c-sub">${ME.role}</div>
      <a class="link-row" href="${ME.linkedin}" target="_blank" rel="noopener">
        <span class="lr-icon">💼</span>
        <span class="lr-text"><div class="lr-label">OPEN PROFILE</div><div class="lr-val">linkedin.com/in/mridulrao</div></span>
        <span class="lr-arrow">→</span>
      </a>`,
  });
}