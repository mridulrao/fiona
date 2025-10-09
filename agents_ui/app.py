# app.py
import asyncio
from typing import Dict, Optional, Tuple

from fastapi import FastAPI, HTTPException, Depends, Header, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from livekit.agents.voice import AgentSession

# ---- Create ONE app instance ----
app = FastAPI(title="LiveKit UI Agent Control API")

# ---- CORS (dev-friendly) ----
# If you want to restrict later, replace allow_origins=["*"] with
# allow_origin_regex=r"https://.*\.ngrok\.app|http://localhost:5500"
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],      # ok with allow_credentials=False
    allow_methods=["*"],      # MUST include OPTIONS
    allow_headers=["*"],      # MUST include Authorization
    expose_headers=["*"],
    allow_credentials=False,
    max_age=600,
)

# (Optional) safety: catch-all OPTIONS (not required if CORS is active)
@app.options("/{path:path}")
async def any_options(path: str):
    return Response(status_code=204)

# ---- Simple bearer auth (dev) ----
API_TOKEN = "super-secret"
def require_token(authorization: Optional[str] = Header(None)):
    if authorization != f"Bearer {API_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")

# ---- In-memory AgentSession registry ----
class SessionRegistry:
    def __init__(self):
        self._lock = asyncio.Lock()
        self._sessions: Dict[Tuple[str, str], AgentSession] = {}

    async def put(self, room: str, agent_id: str, session: AgentSession):
        async with self._lock:
            self._sessions[(room, agent_id)] = session

    async def remove(self, room: str, agent_id: str):
        async with self._lock:
            self._sessions.pop((room, agent_id), None)

    async def get(self, room: str, agent_id: str) -> Optional[AgentSession]:
        async with self._lock:
            return self._sessions.get((room, agent_id))

    async def all(self):
        async with self._lock:
            return [{"room": r, "agent_id": a} for (r, a) in self._sessions.keys()]

registry = SessionRegistry()

# ---- Schemas ----
class SendTextIn(BaseModel):
    room: str
    agent_id: str
    text: str

class InterruptIn(BaseModel):
    room: str
    agent_id: str

# ---- Endpoints ----
@app.get("/sessions")
async def list_sessions(_: None = Depends(require_token)):
    return await registry.all()

@app.post("/send_text")
async def send_text(body: SendTextIn, _: None = Depends(require_token)):
    session = await registry.get(body.room, body.agent_id)
    if not session:
        raise HTTPException(status_code=404, detail="Agent session not found")
    await session.say(body.text)
    return {"ok": True}

@app.post("/send_interrupt")
async def send_interrupt(body: InterruptIn, _: None = Depends(require_token)):
    session = await registry.get(body.room, body.agent_id)
    if not session:
        raise HTTPException(status_code=404, detail="Agent session not found")
    await session.interrupt()
    return {"ok": True}

# ---- Utilities the agent calls ----
async def register_agent_session(room: str, agent_id: str, session: AgentSession):
    await registry.put(room, agent_id, session)

async def unregister_agent_session(room: str, agent_id: str):
    await registry.remove(room, agent_id)
