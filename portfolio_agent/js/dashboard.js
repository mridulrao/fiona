const sessionsBody = document.getElementById('events-body');
const turnsBody = document.getElementById('turns-body');
const refreshBtn = document.getElementById('refresh-btn');
const autoRefreshInput = document.getElementById('auto-refresh');
const applyFiltersBtn = document.getElementById('apply-filters');

const filters = {
  source: document.getElementById('filter-source'),
  eventType: document.getElementById('filter-event-type'),
  toolName: document.getElementById('filter-tool-name'),
  status: document.getElementById('filter-status'),
  since: document.getElementById('filter-since'),
};

const statNodes = {
  totalSessions: document.getElementById('stat-total-sessions'),
  sessionsLastHour: document.getElementById('stat-sessions-last-hour'),
  totalTurns: document.getElementById('stat-total-turns'),
  toolSuccessRate: document.getElementById('stat-tool-success-rate'),
  sessionAvg: document.getElementById('stat-session-avg'),
  sessionP95: document.getElementById('stat-session-p95'),
};

let refreshTimer = null;
let selectedSessionId = null;

async function fetchJsonOrThrow(url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    const snippet = text.slice(0, 160).replace(/\s+/g, ' ').trim();
    throw new Error(`Non-JSON response from ${url} (status ${res.status}): ${snippet}`);
  }
  if (!res.ok) {
    throw new Error(json.error ?? `Request failed (${res.status}) for ${url}`);
  }
  return json;
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

function queryStringFromFilters() {
  const q = new URLSearchParams();
  q.set('limit', '200');

  if (filters.source.value) q.set('source', filters.source.value);
  if (filters.status.value) q.set('status', filters.status.value);
  if (filters.since.value) {
    const asIso = new Date(filters.since.value).toISOString();
    q.set('since', asIso);
  }
  if (filters.eventType.value.trim()) q.set('eventType', filters.eventType.value.trim());
  if (filters.toolName.value.trim()) q.set('toolName', filters.toolName.value.trim());
  return q.toString();
}

function renderTurns(turns) {
  if (!Array.isArray(turns) || turns.length === 0) {
    turnsBody.innerHTML = '<tr><td colspan="6">No turns for selected session</td></tr>';
    return;
  }
  turnsBody.innerHTML = turns
    .map((turn) => {
      const payload = JSON.stringify(turn.payload ?? {}, null, 2);
      const statusClass =
        turn.status === 'success' ? 'status-success' : turn.status === 'error' ? 'status-error' : '';
      return `
        <tr>
          <td>${escapeHtml(formatTime(turn.ts))}</td>
          <td>${escapeHtml(turn.eventType ?? '-')}</td>
          <td>${escapeHtml(turn.toolName ?? '-')}</td>
          <td class="${statusClass}">${escapeHtml(turn.status ?? '-')}</td>
          <td>${turn.durationMs ?? '-'}</td>
          <td class="payload">${escapeHtml(payload)}</td>
        </tr>
      `;
    })
    .join('');
}

async function loadSessionTurns(sessionId) {
  selectedSessionId = sessionId;
  try {
    const q = new URLSearchParams();
    if (filters.eventType.value.trim()) q.set('eventType', filters.eventType.value.trim());
    if (filters.toolName.value.trim()) q.set('toolName', filters.toolName.value.trim());
    if (filters.status.value) q.set('status', filters.status.value);
    const detailJson = await fetchJsonOrThrow(
      `/observability/sessions/${encodeURIComponent(sessionId)}?${q.toString()}`
    );
    renderTurns(detailJson.session?.turns ?? []);
  } catch (error) {
    turnsBody.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message || String(error))}</td></tr>`;
  }
}

function renderSessions(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    sessionsBody.innerHTML = '<tr><td colspan="11">No sessions</td></tr>';
    renderTurns([]);
    return;
  }

  sessionsBody.innerHTML = sessions
    .map((session) => {
      const status = String(session.status ?? '');
      const statusClass = status === 'success' ? 'status-success' : status === 'error' ? 'status-error' : '';
      const usageSummary = session.summary?.usageSummary ?? null;
      const usageText = usageSummary
        ? `prompt=${usageSummary.llmPromptTokens ?? 0}, completion=${usageSummary.llmCompletionTokens ?? 0}, sttMs=${usageSummary.sttAudioDurationMs ?? 0}, ttsChars=${usageSummary.ttsCharactersCount ?? 0}`
        : '-';
      const toolMap = session.summary?.toolUsageByName ?? {};
      const toolText = Object.keys(toolMap).length
        ? Object.entries(toolMap)
            .map(([name, meta]) => `${name}(${meta.count ?? 0}/${meta.errors ?? 0}err)`)
            .join(', ')
        : '-';
      return `
        <tr data-session-id="${escapeHtml(session.session_id)}">
          <td>${escapeHtml(session.session_id)}</td>
          <td>${escapeHtml(formatTime(session.updated_at))}</td>
          <td>${escapeHtml(session.room_name ?? '-')}</td>
          <td>${escapeHtml(session.source ?? '-')}</td>
          <td class="${statusClass}">${escapeHtml(status || '-')}</td>
          <td>${session.event_count ?? 0}</td>
          <td>${session.tool_calls ?? 0}</td>
          <td>${session.tool_errors ?? 0}</td>
          <td>${session.duration_ms ?? '-'}</td>
          <td class="payload">${escapeHtml(usageText)}</td>
          <td class="payload">${escapeHtml(toolText)}</td>
        </tr>
      `;
    })
    .join('');

  for (const row of sessionsBody.querySelectorAll('tr[data-session-id]')) {
    row.addEventListener('click', () => {
      const sessionId = row.getAttribute('data-session-id');
      if (!sessionId) return;
      loadSessionTurns(sessionId);
    });
  }

  const preferredSession = sessions.find((s) => s.session_id === selectedSessionId) ?? sessions[0];
  if (preferredSession?.session_id) {
    loadSessionTurns(preferredSession.session_id);
  }
}

function renderSummary(summary) {
  statNodes.totalSessions.textContent = String(summary.totalSessions ?? 0);
  statNodes.sessionsLastHour.textContent = String(summary.sessionsLastHour ?? 0);
  statNodes.totalTurns.textContent = String(summary.totalTurns ?? 0);
  statNodes.toolSuccessRate.textContent = `${Math.round((summary.toolSuccessRate ?? 0) * 100)}%`;
  statNodes.sessionAvg.textContent = `${summary.sessionDuration?.avgMs ?? 0} ms`;
  statNodes.sessionP95.textContent = `${summary.sessionDuration?.p95Ms ?? 0} ms`;
}

async function loadDashboard() {
  try {
    const query = queryStringFromFilters();
    const [sessionsJson, summaryJson] = await Promise.all([
      fetchJsonOrThrow(`/observability/sessions?${query}`),
      fetchJsonOrThrow('/observability/summary?limit=2000'),
    ]);

    renderSessions(sessionsJson.sessions);
    renderSummary(summaryJson);
  } catch (error) {
    sessionsBody.innerHTML = `<tr><td colspan="11">${escapeHtml(error.message || String(error))}</td></tr>`;
    turnsBody.innerHTML = '<tr><td colspan="6">No turns</td></tr>';
  }
}

function updateAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (autoRefreshInput.checked) {
    refreshTimer = setInterval(loadDashboard, 5000);
  }
}

refreshBtn.addEventListener('click', loadDashboard);
applyFiltersBtn.addEventListener('click', loadDashboard);
autoRefreshInput.addEventListener('change', updateAutoRefresh);

updateAutoRefresh();
loadDashboard();
