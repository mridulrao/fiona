import os
import hmac
import json
import hashlib
import logging
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from vonage import Auth, Vonage
from vonage_messages import Sms


load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("vonage_sms_service")


# -----------------------------------------------------------------------------
# Environment
# -----------------------------------------------------------------------------
# Recommended auth for Messages API is application_id + private_key.
# Keep these in your .env, never hardcode secrets.
VONAGE_APPLICATION_ID = os.getenv("VONAGE_APPLICATION_ID")
VONAGE_PRIVATE_KEY = os.getenv("VONAGE_PRIVATE_KEY")
VONAGE_PRIVATE_KEY_PATH = os.getenv("VONAGE_PRIVATE_KEY_PATH")
VONAGE_API_KEY = os.getenv("VONAGE_API_KEY")
VONAGE_API_SECRET = os.getenv("VONAGE_API_SECRET")
VONAGE_FROM_NUMBER = os.getenv("VONAGE_FROM_NUMBER")

# Optional: webhook verification secret if you enable signed webhooks.
# This is NOT your API secret.
VONAGE_WEBHOOK_SIGNING_SECRET = os.getenv("VONAGE_WEBHOOK_SIGNING_SECRET")


# -----------------------------------------------------------------------------
# App
# -----------------------------------------------------------------------------
app = FastAPI(title="Vonage SMS Service", version="1.0.0")


# -----------------------------------------------------------------------------
# Models
# -----------------------------------------------------------------------------
class SendMessageRequest(BaseModel):
    to: str = Field(..., description="Destination phone number in E.164-like format, e.g. 14155551234")
    text: str = Field(..., min_length=1, description="SMS body")
    from_: Optional[str] = Field(default=None, alias="from", description="Optional override sender")

    class Config:
        populate_by_name = True


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def _load_private_key() -> Optional[str]:
    if VONAGE_PRIVATE_KEY:
        return VONAGE_PRIVATE_KEY

    if VONAGE_PRIVATE_KEY_PATH and os.path.exists(VONAGE_PRIVATE_KEY_PATH):
        with open(VONAGE_PRIVATE_KEY_PATH, "r", encoding="utf-8") as f:
            return f.read()

    return None


def get_vonage_client() -> Vonage:
    private_key = _load_private_key()

    # Preferred for Messages API.
    if VONAGE_APPLICATION_ID and private_key:
        return Vonage(
            Auth(
                application_id=VONAGE_APPLICATION_ID,
                private_key=private_key,
            )
        )

    # Fallback to basic auth only if you really need it.
    if VONAGE_API_KEY and VONAGE_API_SECRET:
        return Vonage(
            Auth(
                api_key=VONAGE_API_KEY,
                api_secret=VONAGE_API_SECRET,
            )
        )

    raise RuntimeError(
        "Missing Vonage credentials. Set either VONAGE_APPLICATION_ID + VONAGE_PRIVATE_KEY(_PATH) "
        "or VONAGE_API_KEY + VONAGE_API_SECRET."
    )


def verify_vonage_webhook(raw_body: bytes, authorization_header: Optional[str]) -> bool:
    """
    Optional verification helper.

    For Vonage Messages API signed webhooks, Vonage can send a JWT bearer token.
    The exact verification flow depends on how you configure webhook signing.

    This helper provides a simple HMAC fallback pattern for teams that choose to
    protect their own edge or proxy. If you are using Vonage signed webhooks,
    replace this with your exact JWT verification logic.
    """
    if not VONAGE_WEBHOOK_SIGNING_SECRET:
        return True

    if not authorization_header:
        return False

    expected = hmac.new(
        VONAGE_WEBHOOK_SIGNING_SECRET.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()

    provided = authorization_header.removeprefix("Bearer ").strip()
    return hmac.compare_digest(expected, provided)


def _extract_text(payload: Dict[str, Any]) -> Optional[str]:
    """Best-effort extraction for common inbound payload shapes."""
    if isinstance(payload.get("text"), str):
        return payload["text"]

    message = payload.get("message")
    if isinstance(message, dict):
        if isinstance(message.get("content"), dict):
            content = message["content"]
            if isinstance(content.get("text"), str):
                return content["text"]
        if isinstance(message.get("text"), str):
            return message["text"]

    if isinstance(payload.get("content"), dict) and isinstance(payload["content"].get("text"), str):
        return payload["content"]["text"]

    return None


def _extract_from(payload: Dict[str, Any]) -> Optional[str]:
    sender = payload.get("from")
    if isinstance(sender, str):
        return sender
    if isinstance(sender, dict):
        if isinstance(sender.get("number"), str):
            return sender["number"]
        if isinstance(sender.get("id"), str):
            return sender["id"]

    if isinstance(payload.get("msisdn"), str):
        return payload["msisdn"]

    return None


# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------
@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/send_message")
def send_message(body: SendMessageRequest):
    sender = body.from_ or VONAGE_FROM_NUMBER
    if not sender:
        raise HTTPException(status_code=500, detail="Missing sender number. Set VONAGE_FROM_NUMBER or pass from in request body.")

    try:
        client = get_vonage_client()
        response = client.messages.send(
            Sms(
                to=body.to,
                from_=sender,
                text=body.text,
            )
        )

        logger.info("Sent message to=%s from=%s response=%s", body.to, sender, response)
        return {"ok": True, "response": response}
    except Exception as exc:
        logger.exception("Failed to send SMS")
        raise HTTPException(status_code=500, detail=f"Failed to send SMS: {exc}") from exc


@app.post("/inbound")
async def inbound(request: Request):
    raw_body = await request.body()
    auth_header = request.headers.get("Authorization")

    if not verify_vonage_webhook(raw_body, auth_header):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        payload = await request.json()
    except Exception:
        payload = {"raw": raw_body.decode("utf-8", errors="replace")}

    logger.info("Inbound webhook payload=%s", json.dumps(payload, ensure_ascii=False))

    sender = _extract_from(payload)
    text = _extract_text(payload)

    # TODO: call your voice agent / orchestrator here.
    # Example:
    # agent_reply = your_bot.handle_incoming_message(user_id=sender, text=text)

    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "event": "inbound_received",
            "from": sender,
            "text": text,
            "payload": payload,
        },
    )


@app.api_route("/status", methods=["GET", "POST"])
async def status_webhook(request: Request):
    try:
        if request.method == "GET":
            payload = dict(request.query_params)
        else:
            payload = await request.json()
    except Exception:
        payload = {"raw": (await request.body()).decode("utf-8", errors="replace")}

    logger.info("Status webhook payload=%s", json.dumps(payload, ensure_ascii=False))
    return {"ok": True}


# Optional convenience endpoint to receive a message and auto-reply.
@app.post("/inbound_autoreply")
async def inbound_autoreply(request: Request):
    raw_body = await request.body()
    payload = await request.json()

    if not verify_vonage_webhook(raw_body, request.headers.get("Authorization")):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    sender = _extract_from(payload)
    inbound_text = _extract_text(payload)

    if not sender:
        raise HTTPException(status_code=400, detail="Could not determine sender from webhook payload")

    reply_text = f"Received: {inbound_text}" if inbound_text else "Message received."

    client = get_vonage_client()
    response = client.messages.send(
        Sms(
            to=sender,
            from_=VONAGE_FROM_NUMBER,
            text=reply_text,
        )
    )

    logger.info("Auto-replied to=%s response=%s", sender, response)
    return {"ok": True, "reply_response": response}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("vonage_message_integration:app", host="0.0.0.0", port=8000, reload=True)