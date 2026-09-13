from __future__ import annotations

import logging
from typing import Optional

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

logger = logging.getLogger(__name__)

_llm_model = None
_llm_tokenizer = None


def get_quantization_config() -> BitsAndBytesConfig:
    """4-bit quantization config for T4 GPU (no Flash Attention 2)."""
    return BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
    )


def load_llm(
    model_name: str = "Qwen/Qwen3-8B",
    device: str = "cuda",
    load_in_4bit: bool = True,
) -> tuple:
    """Load Qwen3-8B with 4-bit quantization."""
    global _llm_model, _llm_tokenizer

    if _llm_model is not None and _llm_tokenizer is not None:
        logger.info("LLM already loaded, returning cached")
        return _llm_model, _llm_tokenizer

    logger.info("Loading LLM: %s (4bit=%s, device=%s)", model_name, load_in_4bit, device)

    tokenizer = AutoTokenizer.from_pretrained(
        model_name,
        trust_remote_code=True,
    )

    model_kwargs = {
        "trust_remote_code": True,
        "device_map": "auto",
    }

    if load_in_4bit:
        model_kwargs["quantization_config"] = get_quantization_config()
    else:
        model_kwargs["torch_dtype"] = torch.float16

    model_kwargs["attn_implementation"] = "eager"

    model = AutoModelForCausalLM.from_pretrained(model_name, **model_kwargs)

    _llm_model = model
    _llm_tokenizer = tokenizer

    logger.info("LLM loaded successfully")
    return model, tokenizer


def get_llm() -> tuple:
    """Get the loaded LLM instance (must call load_llm first)."""
    if _llm_model is None:
        raise RuntimeError("LLM not loaded. Call load_llm() first.")
    return _llm_model, _llm_tokenizer


def unload_llm():
    """Free LLM memory."""
    global _llm_model, _llm_tokenizer
    if _llm_model is not None:
        del _llm_model
        del _llm_tokenizer
        _llm_model = None
        _llm_tokenizer = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        logger.info("LLM unloaded")
