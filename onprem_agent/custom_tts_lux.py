"""
Custom LiveKit TTS implementation for LuxTTS over websocket streaming.

This adapter connects to zipvoice.ws_tts_server and turns each LiveKit flush
into one LuxTTS websocket synthesis request. The server streams back raw PCM
chunks, which are pushed directly into the LiveKit audio emitter.
"""

import asyncio
import json
from typing import Any, Dict, Optional

import aiohttp
from livekit.agents import APIConnectionError, APIConnectOptions, APIError, tts
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS


class LuxWebSocketTTS(tts.TTS):
    def __init__(
        self,
        *,
        base_url: str = "ws://127.0.0.1:8765",
        prompt_audio: str,
        sample_rate: int = 16000,
        ref_duration: float = 4.0,
        rms: float = 0.01,
        num_steps: int = 2,
        t_shift: float = 0.65,
        guidance_scale: float = 2.5,
        speed: float = 0.8,
        return_smooth: bool = False,
        chunk_bytes: int = 4096,
    ):
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=True),
            sample_rate=sample_rate,
            num_channels=1,
        )

        if base_url.startswith("https://"):
            ws_url = base_url.replace("https://", "wss://", 1)
        elif base_url.startswith("http://"):
            ws_url = base_url.replace("http://", "ws://", 1)
        else:
            ws_url = base_url

        self._ws_url = ws_url.rstrip("/")
        self._session: Optional[aiohttp.ClientSession] = None
        self._prompt_audio = prompt_audio
        self._config: Dict[str, Any] = {
            "prompt_audio": prompt_audio,
            "ref_duration": ref_duration,
            "rms": rms,
            "num_steps": num_steps,
            "t_shift": t_shift,
            "guidance_scale": guidance_scale,
            "speed": speed,
            "return_smooth": return_smooth,
            "chunk_bytes": chunk_bytes,
        }

    def _ensure_session(self) -> aiohttp.ClientSession:
        if self._session is None:
            self._session = aiohttp.ClientSession()
        return self._session

    def stream(
        self,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> "LuxWebSocketStream":
        return LuxWebSocketStream(tts=self, conn_options=conn_options)

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> tts.ChunkedStream:
        raise NotImplementedError(
            "Chunked synthesis is not implemented for LuxWebSocketTTS. Use stream()."
        )

    async def aclose(self) -> None:
        if self._session is not None:
            await self._session.close()
            self._session = None


class LuxWebSocketStream(tts.SynthesizeStream):
    def __init__(
        self,
        tts: LuxWebSocketTTS,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ):
        super().__init__(tts=tts, conn_options=conn_options)
        self._tts = tts
        self._request_index = 0

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        session = self._tts._ensure_session()
        text_buffer: list[str] = []

        try:
            async with session.ws_connect(self._tts._ws_url) as ws:
                model_info = await self._fetch_model_info(ws)
                output_emitter.initialize(
                    request_id=f"luxtts-ws-{id(self)}",
                    sample_rate=int(model_info.get("sample_rate", self._tts.sample_rate)),
                    num_channels=self._tts.num_channels,
                    mime_type="audio/pcm",
                )

                async for input_item in self._input_ch:
                    if isinstance(input_item, str):
                        text_buffer.append(input_item)
                        continue

                    if isinstance(input_item, self._FlushSentinel):
                        if text_buffer:
                            text = self._merge_text(text_buffer)
                            text_buffer.clear()
                            await self._synthesize_once(ws, text, output_emitter)

                if text_buffer:
                    await self._synthesize_once(ws, self._merge_text(text_buffer), output_emitter)

                output_emitter.flush()

        except aiohttp.ClientError as exc:
            raise APIConnectionError(f"LuxTTS websocket connection error: {exc}") from exc
        except Exception as exc:
            raise APIError(f"LuxTTS websocket TTS failed: {exc}") from exc

    async def _fetch_model_info(self, ws: aiohttp.ClientWebSocketResponse) -> Dict[str, Any]:
        request_id = self._next_request_id("model-info")
        await ws.send_json({"type": "model_info", "request_id": request_id})
        response = await ws.receive_json()
        if response.get("type") == "error":
            raise APIError(response.get("message", "model_info failed"))
        return response

    async def _synthesize_once(
        self,
        ws: aiohttp.ClientWebSocketResponse,
        text: str,
        output_emitter: tts.AudioEmitter,
    ) -> None:
        if not text.strip():
            return

        request_id = self._next_request_id("synth")
        payload = {
            "type": "synthesize",
            "request_id": request_id,
            "text": text,
            **self._tts._config,
        }
        await ws.send_json(payload)

        first_message = await ws.receive_json()
        if first_message.get("type") == "error":
            raise APIError(first_message.get("message", "synthesis failed"))
        if first_message.get("type") != "audio_start":
            raise APIError(f"Unexpected LuxTTS websocket response: {first_message}")

        while True:
            msg = await ws.receive()
            if msg.type == aiohttp.WSMsgType.BINARY:
                output_emitter.push(msg.data)
                continue

            if msg.type == aiohttp.WSMsgType.TEXT:
                payload = json.loads(msg.data)
                if payload.get("request_id") != request_id:
                    continue

                msg_type = payload.get("type")
                if msg_type == "metrics":
                    continue
                if msg_type == "done":
                    return
                if msg_type == "error":
                    raise APIError(payload.get("message", "LuxTTS server error"))
                continue

            if msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED):
                raise APIConnectionError("LuxTTS websocket closed during synthesis")

            if msg.type == aiohttp.WSMsgType.ERROR:
                raise APIConnectionError(f"LuxTTS websocket error: {msg.data}")

    def _merge_text(self, text_buffer: list[str]) -> str:
        merged = " ".join(part.strip() for part in text_buffer if part and part.strip())
        return " ".join(merged.split())

    def _next_request_id(self, prefix: str) -> str:
        self._request_index += 1
        return f"{prefix}-{id(self)}-{self._request_index}"


async def example_usage():
    tts_engine = LuxWebSocketTTS(
        base_url="ws://127.0.0.1:8765",
        prompt_audio="shahrukh_voice.mp3",
        num_steps=2,
    )

    stream = tts_engine.stream()
    stream.push_text("Hello. This is LuxTTS over websocket.")
    stream.flush()
    stream.push_text("This should be usable inside a LiveKit agent.")
    stream.flush()
    stream.end_input()

    async for audio_chunk in stream:
        print(f"Received audio: {len(audio_chunk.data)} bytes")

    await tts_engine.aclose()


if __name__ == "__main__":
    asyncio.run(example_usage())
