"""
Custom LiveKit TTS implementation for Chatterbox using WebSocket streaming.
This provides true bidirectional streaming - better for real-time applications.
"""

import asyncio
import base64
import json
from typing import Optional

import aiohttp
from livekit.agents import tts
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS
from livekit.agents import APIError, APIConnectionError, APIConnectOptions


class CustomWebSocketTTS(tts.TTS):
    """
    WebSocket-based TTS implementation for Chatterbox.
    
    Advantages over HTTP streaming:
    - True bidirectional streaming
    - Send text chunks incrementally  
    - Lower latency for interactive applications
    - Can send multiple text chunks without reconnecting
    """
    
    def __init__(
        self,
        *,
        base_url: str = "https://fpt8xigoz8g6xf-8004.proxy.runpod.net",
        voice_mode: str = "predefined",
        predefined_voice_id: Optional[str] = None,
        reference_audio_filename: Optional[str] = None,
        language: str = "en",
        temperature: float = 0.8,
        exaggeration: float = 0.5,
        cfg_weight: float = 0.5,
        chunk_size: int = 25,
        first_chunk_size: int = 5,
        output_format: str = "wav",
        sample_rate: int = 24000,
    ):
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=True),
            sample_rate=sample_rate,
            num_channels=1,
        )
        
        # Convert HTTPS to WSS for WebSocket
        if base_url.startswith("https://"):
            ws_url = base_url.replace("https://", "wss://")
        elif base_url.startswith("http://"):
            ws_url = base_url.replace("http://", "ws://")
        else:
            ws_url = base_url
        
        self._ws_url = ws_url.rstrip("/") + "/ws/tts/stream"
        self._session: Optional[aiohttp.ClientSession] = None
        
        # TTS configuration
        self._config = {
            "voice_mode": voice_mode,
            "predefined_voice_id": predefined_voice_id,
            "reference_audio_filename": reference_audio_filename,
            "language": language,
            "temperature": temperature,
            "exaggeration": exaggeration,
            "cfg_weight": cfg_weight,
            "chunk_size": chunk_size,
            "first_chunk_size": first_chunk_size,
            "output_format": output_format,
        }
        
        # Validate voice configuration
        if voice_mode == "predefined" and not predefined_voice_id:
            raise ValueError("predefined_voice_id required when voice_mode='predefined'")
        if voice_mode == "clone" and not reference_audio_filename:
            raise ValueError("reference_audio_filename required when voice_mode='clone'")

    def _ensure_session(self) -> aiohttp.ClientSession:
        """Ensure aiohttp session exists."""
        if not self._session:
            self._session = aiohttp.ClientSession()
        return self._session

    def stream(self, *, conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS) -> "CustomWebSocketStream":  
        """Create a new synthesis stream."""  
        return CustomWebSocketStream(tts=self, conn_options=conn_options)

    def synthesize(  
        self,   
        text: str,   
        *,   
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS  
    ) -> tts.ChunkedStream:  
        """Non-streaming synthesis not supported for WebSocket TTS."""  
        raise NotImplementedError(  
            "Chunked synthesis is not supported by CustomWebSocketTTS. "  
            "Use the stream() method for streaming synthesis."  
        )

    async def aclose(self) -> None:
        """Close the aiohttp session."""
        if self._session:
            await self._session.close()
            self._session = None


class CustomWebSocketStream(tts.SynthesizeStream):
    """
    WebSocket-based synthesis stream.
    
    Supports true incremental text streaming:
    - Send text chunks as they arrive
    - Flush when ready to synthesize
    - Receive audio chunks in real-time
    """
    
    def __init__(self, tts: CustomWebSocketTTS, conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS):
        super().__init__(tts=tts, conn_options=conn_options)
        self._tts = tts

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        """
        Main synthesis loop using WebSocket.
        """
        session = self._tts._ensure_session()
        
        try:
            async with session.ws_connect(self._tts._ws_url) as ws:
                # Send initial configuration
                config_msg = {
                    "type": "config",
                    **self._tts._config
                }
                await ws.send_json(config_msg)
                
                # Wait for config acknowledgment
                response = await ws.receive_json()
                if response.get("type") != "config_ack":
                    raise tts.APIError(f"Configuration failed: {response}")
                
                # Initialize output emitter
                output_emitter.initialize(
                    request_id=f"chatterbox-ws-{id(self)}",
                    sample_rate=self._tts.sample_rate,
                    num_channels=self._tts.num_channels,
                    mime_type="audio/pcm",
                )
                
                # Create tasks for sending and receiving
                send_task = asyncio.create_task(
                    self._send_text_loop(ws)
                )
                receive_task = asyncio.create_task(
                    self._receive_audio_loop(ws, output_emitter)
                )
                
                # Wait for both to complete
                await asyncio.gather(send_task, receive_task)
                
                # Send close message
                await ws.send_json({"type": "close"})
                
                output_emitter.flush()
        
        except aiohttp.ClientError as e:
            raise tts.APIConnectionError(f"WebSocket connection error: {e}")
        except Exception as e:  
            raise APIError(f"WebSocket TTS failed: {e}")

    async def _send_text_loop(self, ws: aiohttp.ClientWebSocketResponse):
        """
        Send text chunks to the WebSocket as they arrive.
        """
        text_buffer = []
        
        async for input_item in self._input_ch:
            if isinstance(input_item, str):
                # Buffer text
                text_buffer.append(input_item)
                
                # Optionally send immediately for very low latency
                # await ws.send_json({"type": "text", "data": input_item})
                
            elif isinstance(input_item, self._FlushSentinel):
                # Send all buffered text and flush
                if text_buffer:
                    full_text = " ".join(text_buffer)
                    await ws.send_json({"type": "text", "data": full_text})
                    text_buffer.clear()
                
                # Trigger synthesis
                await ws.send_json({"type": "flush"})
        
        # Send any remaining text
        if text_buffer:
            full_text = " ".join(text_buffer)
            await ws.send_json({"type": "text", "data": full_text})
            await ws.send_json({"type": "flush"})

    async def _receive_audio_loop(
        self,
        ws: aiohttp.ClientWebSocketResponse,
        output_emitter: tts.AudioEmitter
    ):
        """
        Receive and process audio chunks from the WebSocket.
        """
        while True:
            msg = await ws.receive()
            
            if msg.type == aiohttp.WSMsgType.TEXT:
                data = json.loads(msg.data)
                msg_type = data.get("type")
                
                if msg_type == "audio":
                    # Decode base64 audio data
                    audio_b64 = data.get("data")
                    if audio_b64:
                        audio_bytes = base64.b64decode(audio_b64)
                        
                        # Decode to PCM
                        pcm_data = self._decode_audio_chunk(
                            audio_bytes,
                            data.get("format", "wav")
                        )
                        
                        if pcm_data:
                            output_emitter.push(pcm_data)
                
                elif msg_type == "done":
                    # Synthesis complete for this flush
                    continue
                
                elif msg_type == "error":  
                    error_msg = data.get("message", "Unknown error")  
                    raise APIError(f"Server error: {error_msg}")
                
                elif msg_type == "goodbye":
                    # Server acknowledged close
                    break
            
            elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED):
                break
            
            elif msg.type == aiohttp.WSMsgType.ERROR:
                raise tts.APIConnectionError(f"WebSocket error: {msg.data}")

    def _decode_audio_chunk(self, data: bytes, format: str) -> Optional[bytes]:
        """
        Decode audio chunk to raw PCM.
        
        Args:
            data: Encoded audio data (WAV or Opus)
            format: 'wav' or 'opus'
        
        Returns:
            Raw PCM audio data, or None if decoding fails
        """
        if not data:
            return None
        
        try:
            if format == "wav":
                # Decode WAV to PCM
                import wave
                import io
                
                with wave.open(io.BytesIO(data), 'rb') as wav_file:
                    # Verify format
                    assert wav_file.getnchannels() == self._tts.num_channels
                    assert wav_file.getframerate() == self._tts.sample_rate
                    
                    # Read raw PCM
                    return wav_file.readframes(wav_file.getnframes())
            
            elif format == "opus":
                # Opus decoding (requires opuslib)
                try:
                    import opuslib
                    decoder = opuslib.Decoder(
                        self._tts.sample_rate,
                        self._tts.num_channels
                    )
                    return decoder.decode(data, frame_size=960)
                except ImportError:
                    raise NotImplementedError(
                        "Opus decoding requires 'opuslib'. "
                        "Install with: pip install opuslib"
                    )
            
            else:
                raise ValueError(f"Unsupported format: {format}")
        
        except Exception as e:
            print(f"Warning: Failed to decode audio: {e}")
            return None


# Example usage
async def example_usage():
    """Example of using WebSocket TTS with LiveKit."""
    
    # Initialize WebSocket TTS
    tts_engine = CustomWebSocketTTS(
        base_url="https://k1ho193a7ifqs6-8004.proxy.runpod.net",
        voice_mode="predefined",
        predefined_voice_id="Abigail.wav",
        language="en",
        chunk_size=25,
        first_chunk_size=5,
        output_format="wav",
    )
    
    # Create synthesis stream
    stream = tts_engine.stream()
    
    # Send text incrementally (more natural for conversation)
    stream.push_text("Hello!")
    stream.push_text("How are you today?")
    stream.flush()  # Trigger synthesis
    
    # Can continue sending more text
    stream.push_text("This is a streaming test.")
    stream.flush()
    
    # End input
    stream.end_input()
    
    # Consume audio chunks
    async for audio_chunk in stream:
        print(f"Received audio: {len(audio_chunk.data)} bytes")
        # Process audio_chunk.data (raw PCM)
    
    # Cleanup
    await tts_engine.aclose()


if __name__ == "__main__":
    asyncio.run(example_usage())