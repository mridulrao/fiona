import os
import re
import json
import time
import asyncio
import logging
from typing import Any, Dict, List, Optional, Union

from openai import AsyncOpenAI

from livekit.agents import llm
from livekit.agents.types import APIConnectOptions, DEFAULT_API_CONNECT_OPTIONS
from livekit.agents.llm import ToolChoice
from livekit.agents.llm.chat_context import ChatContext
from livekit.agents.llm.tool_context import FunctionTool, RawFunctionTool
from livekit.agents.llm.tool_context import (  
    get_raw_function_info,  
    is_function_tool,  
    is_raw_function_tool,  
)  
from livekit.agents import llm

logger = logging.getLogger("on-prem-agent")
logger.setLevel(logging.DEBUG)

# Your gateway model emits tool calls as:
#   <tool_call>{"name": "...", "arguments": {...}}</tool_call>
_TOOL_BLOCK_RE = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.DOTALL)


def _extract_tool_calls(text: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for m in _TOOL_BLOCK_RE.findall(text or ""):
        try:
            out.append(json.loads(m))
        except json.JSONDecodeError as e:
            logger.error("Failed to parse tool_call JSON: %s | raw=%r", e, m)
    return out


def _strip_tool_blocks(text: str) -> str:
    if not text:
        return ""
    cleaned = re.sub(r"<tool_call>.*?</tool_call>", "", text, flags=re.DOTALL)
    # also strip Qwen-ish markers if present
    cleaned = re.sub(r"<\|im_end\|>|<\|im_start\|>", "", cleaned)
    return cleaned


def _chat_ctx_to_openai_messages(chat_ctx: ChatContext) -> List[Dict[str, Any]]:  
    """  
    Convert LiveKit ChatContext to OpenAI chat messages.  
    Notes:  
      - LiveKit tool messages typically store tool output in msg.content.  
      - We pass tool messages as {"role":"tool","name":..., "content":...} for compatibility  
        with many OpenAI-compatible gateways.  
    """  
    messages: List[Dict[str, Any]] = []  
    for msg in chat_ctx.items:  # Use .items instead of .messages  
        if msg.type == "message" and msg.role in ("system", "user", "assistant"):  
            messages.append({"role": msg.role, "content": msg.content})  
        elif msg.type == "function_call_output":  
            # Handle tool/function call outputs  
            tool_name = getattr(msg, "name", None)  
            payload: Dict[str, Any] = {"role": "tool", "content": msg.output}  
            if tool_name:  
                payload["name"] = tool_name  
            else:  
                tool_call_id = getattr(msg, "call_id", None)  
                if tool_call_id:  
                    payload["tool_call_id"] = tool_call_id  
            messages.append(payload)  
    return messages


def _tools_to_openai_schema(  
    tools: List[Union[FunctionTool, RawFunctionTool]],   
    *,   
    strict: bool = True  
) -> List[Dict[str, Any]]:  
    """  
    Convert LiveKit FunctionTool/RawFunctionTool into OpenAI "tools" schema.  
    """  
    schemas: List[Dict[str, Any]] = []  
    for t in tools or []:  
        if is_raw_function_tool(t):  
            info = get_raw_function_info(t)  
            schemas.append(  
                {  
                    "type": "function",  
                    "function": info.raw_schema,  
                }  
            )  
        elif is_function_tool(t):  
            schema = (  
                llm.utils.build_strict_openai_schema(t)  
                if strict  
                else llm.utils.build_legacy_openai_schema(t)  
            )  
            schemas.append(schema)  
      
    return schemas


async def _execute_livekit_tool(
    tools: List[Union[FunctionTool, RawFunctionTool]],
    name: str,
    args: Dict[str, Any],
) -> Any:
    """
    Executes a LiveKit tool object (FunctionTool/RawFunctionTool) directly.

    IMPORTANT:
    - This is *manual* tool execution (like your original code).
    - It does not rely on stream.execute_functions().
    - This is fine as long as your agent code expects the LLM adapter
      to do the full tool-loop and only stream speakable text.
    """
    tool_obj = None
    for t in tools:
        if getattr(t, "name", None) == name:
            tool_obj = t
            break

    if tool_obj is None:
        logger.error("Tool not found: %s | args=%s", name, args)
        return {"error": f"Unknown tool: {name}"}

    try:
        logger.info("Executing tool: %s | args=%s", name, args)

        # LiveKit FunctionTool is callable; it will inject RunContext if needed.
        res = tool_obj(**args)  # may return coroutine
        if asyncio.iscoroutine(res):
            res = await res

        logger.debug("Tool result | name=%s | result=%s", name, res)
        return res

    except Exception:
        logger.exception("Tool execution failed: %s | args=%s", name, args)
        return {"error": "tool_execution_failed"}


class GatewayLLM(llm.LLM):
    """
    LiveKit-compatible LLM adapter for an OpenAI-compatible gateway (vLLM),
    where tool calls are returned as tagged blocks:

        <tool_call>{"name": "...", "arguments": {...}}</tool_call>
    """

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        request_timeout_s: float = 60.0,
    ) -> None:
        super().__init__()

        self._api_key = "devkey"
        self._base_url = "https://8ho67nta76qge6-3000.proxy.runpod.net/v1"
        self._model = "Qwen/Qwen3-4B-Instruct-2507"
        self._default_timeout_s = request_timeout_s

        self._client = AsyncOpenAI(api_key=self._api_key, base_url=self._base_url)

        logger.info(
            "GatewayLLM initialized | model=%s | base_url=%s | timeout_s=%.1f",
            self._model,
            self._base_url,
            self._default_timeout_s,
        )

    @property
    def model(self) -> str:
        return self._model

    @property
    def provider(self) -> str:
        return "gateway-vllm"

    async def aclose(self) -> None:
        # AsyncOpenAI doesn't require explicit close in most cases.
        # If you ever pass a custom http client, then close it here.
        logger.info("GatewayLLM aclose called")

    def chat(
        self,
        *,
        chat_ctx: ChatContext,
        tools: List[Union[FunctionTool, RawFunctionTool]] | None = None,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
        parallel_tool_calls: Optional[bool] = None,
        tool_choice: Optional[Union[ToolChoice, str]] = None,
        temperature: Optional[float] = None,
        n: Optional[int] = None,
        extra_kwargs: Optional[Dict[str, Any]] = None,
    ) -> "llm.LLMStream":
        return _GatewayLLMStream(
            llm_parent=self,
            client=self._client,
            model=self._model,
            chat_ctx=chat_ctx,
            tools=tools or [],
            conn_options=conn_options,
            default_timeout_s=self._default_timeout_s,
            temperature=temperature,
            tool_choice=tool_choice,
            extra_kwargs=extra_kwargs or {},
        )


class _GatewayLLMStream(llm.LLMStream):
    """
    Implements the required LLMStream._run() and emits ChatChunk events into self._event_ch.
    """

    def __init__(
        self,
        *,
        llm_parent: GatewayLLM,
        client: AsyncOpenAI,
        model: str,
        chat_ctx: ChatContext,
        tools: List[Union[FunctionTool, RawFunctionTool]],
        conn_options: APIConnectOptions,
        default_timeout_s: float,
        temperature: Optional[float],
        tool_choice: Optional[Union[ToolChoice, str]],
        extra_kwargs: Dict[str, Any],
    ) -> None:
        super().__init__(
            llm_parent,
            chat_ctx=chat_ctx,
            tools=tools, 
            conn_options=conn_options,
        )
        self._client = client
        self._model = model
        self._chat_ctx = chat_ctx
        self._tools = tools
        self._default_timeout_s = default_timeout_s
        self._temperature = temperature
        self._tool_choice = tool_choice
        self._extra_kwargs = extra_kwargs

        self._turn_idx = 0
        self._last_emitted_len = 0

    def _emit_text(self, request_id: str, text_delta: str) -> None:
        if not text_delta:
            return
        chunk = llm.ChatChunk(
            request_id=request_id,
            choices=[
                llm.Choice(
                    delta=llm.ChoiceDelta(role="assistant", content=text_delta),
                    index=0,
                )
            ],
            usage=None,
        )
        self._event_ch.send_nowait(chunk)

    async def _run(self) -> None:
        logger.info("GatewayLLMStream._run start | model=%s", self._model)

        messages = _chat_ctx_to_openai_messages(self._chat_ctx)
        tools_schema = _tools_to_openai_schema(self._tools)

        # timeout: prefer conn_options.timeout if set, else adapter default
        timeout_s = getattr(self._conn_options, "timeout", None) or self._default_timeout_s

        # temperature: prefer call override, else keep gateway default behavior
        temperature = self._temperature if self._temperature is not None else 0.2

        # ---- tool_choice mapping (TypedDict-safe; no isinstance(..., ToolChoice)) ----
        tool_choice = getattr(self, "_tool_choice", None)
        oai_tool_choice: Any = "auto"

        if isinstance(tool_choice, str):
            # "auto" / "none" / "required"
            oai_tool_choice = tool_choice

        elif isinstance(tool_choice, dict):
            # LiveKit ToolChoice is typically a dict-like TypedDict
            # Common shapes:
            #   {"type":"function","function":{"name":"xyz"}}
            #   {"function":{"name":"xyz"}}
            fn = None
            fn_obj = tool_choice.get("function")
            if isinstance(fn_obj, dict):
                fn = fn_obj.get("name")

            if fn:
                oai_tool_choice = {"type": "function", "function": {"name": fn}}
            else:
                oai_tool_choice = "auto"

        elif tool_choice is None:
            oai_tool_choice = "auto"
        else:
            # Unknown runtime type: don't crash; fall back
            logger.debug("Unknown tool_choice type | value=%r | type=%s", tool_choice, type(tool_choice))
            oai_tool_choice = "auto"

        logger.debug(
            "LLM settings | timeout_s=%.2f | temperature=%.3f | tool_choice=%r -> oai_tool_choice=%r | tools_schema=%d",
            float(timeout_s),
            float(temperature),
            tool_choice,
            oai_tool_choice,
            len(tools_schema),
        )

        try:
            while True:
                self._turn_idx += 1
                request_id = f"gateway-turn-{self._turn_idx}"

                logger.info(
                    "LLM turn start | request_id=%s | msgs=%d | tools=%d",
                    request_id,
                    len(messages),
                    len(tools_schema),
                )

                raw_text = ""
                self._last_emitted_len = 0
                t0 = time.perf_counter()
                first_piece = True
                chunk_count = 0

                # Stream from gateway
                stream = await self._client.chat.completions.create(
                    model=self._model,
                    messages=messages,
                    tools=tools_schema or [],
                    tool_choice=oai_tool_choice,
                    temperature=temperature,
                    stream=True,
                    timeout=timeout_s,
                    **self._extra_kwargs,
                )

                async for event in stream:
                    if not getattr(event, "choices", None):
                        continue

                    delta = event.choices[0].delta
                    piece = getattr(delta, "content", None) or ""
                    if not piece:
                        continue

                    chunk_count += 1
                    if first_piece:
                        first_piece = False
                        ttft = time.perf_counter() - t0
                        logger.info("TTFT | request_id=%s | ttft_s=%.4f", request_id, ttft)

                    raw_text += piece

                    # Only stream "speakable" content (strip tool blocks; hold back if mid-tag)
                    speakable = _strip_tool_blocks(raw_text)
                    open_idx = speakable.find("<tool_call>")
                    if open_idx != -1:
                        speakable = speakable[:open_idx]

                    if len(speakable) > self._last_emitted_len:
                        new_text = speakable[self._last_emitted_len :]
                        self._last_emitted_len = len(speakable)
                        self._emit_text(request_id, new_text)

                logger.info(
                    "Gateway stream ended | request_id=%s | chunks=%d | raw_len=%d",
                    request_id,
                    chunk_count,
                    len(raw_text),
                )

                # Parse tool calls from raw_text
                tool_calls = _extract_tool_calls(raw_text)
                final_text = _strip_tool_blocks(raw_text).strip()

                if tool_calls:
                    logger.info("Detected %d tool call(s) | request_id=%s", len(tool_calls), request_id)

                    for tc in tool_calls:
                        fn = tc.get("name")
                        args = tc.get("arguments", {}) or {}
                        if not fn:
                            logger.error("Malformed tool_call (missing name) | tc=%s", tc)
                            continue

                        result = await _execute_livekit_tool(self._tools, fn, args)

                        # Append tool result back into the conversation for the next LLM turn
                        messages.append(
                            {
                                "role": "tool",
                                "name": fn,
                                "content": json.dumps(result, ensure_ascii=False),
                            }
                        )

                    logger.info("Tool results appended; continuing tool loop | msgs=%d", len(messages))
                    continue

                # No tool calls: ensure remaining final text is emitted (if any)
                if final_text:
                    # If you streamed partial content already, emit remainder only.
                    # NOTE: final_text is tool-stripped; may be shorter than raw speakable.
                    if len(final_text) > self._last_emitted_len:
                        remaining = final_text[self._last_emitted_len :]
                        self._emit_text(request_id, remaining)

                logger.info("GatewayLLMStream._run completed | request_id=%s", request_id)
                return

        except asyncio.CancelledError:
            logger.info("GatewayLLMStream cancelled (barge-in) | turn=%d", self._turn_idx)
            return
        except Exception:
            logger.exception("GatewayLLMStream crashed | turn=%d", self._turn_idx)
            raise

