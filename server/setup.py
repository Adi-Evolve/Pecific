#!/usr/bin/env python3
"""
PrivacyLens LLM Server — Universal Setup Script
Works on: Google Colab, Kaggle, Local (with GPU)
Upload this single file and run it. Everything is handled automatically.
"""

import os
import sys
import subprocess
import time
import json
import threading
import importlib
from pathlib import Path

# =============================================================================
# CONFIG
# =============================================================================
LLM_MODEL = "Qwen/Qwen3-8B"
NGROK_AUTH_TOKEN = ""  # Set here for Kaggle/local, or leave empty for Colab prompt
SERVER_PORT = 8000


# =============================================================================
# STEP 0: Detect environment
# =============================================================================
def detect_environment():
    """Detect whether running on Colab, Kaggle, or local."""
    try:
        import google.colab
        return "colab"
    except ImportError:
        pass

    if os.path.exists("/kaggle"):
        return "kaggle"

    return "local"


ENV = detect_environment()
print(f"Detected environment: {ENV.upper()}")


# =============================================================================
# STEP 1: Install dependencies
# =============================================================================
def install_deps():
    """Install all required packages."""
    print("\n[1/6] Installing dependencies...")

    deps = [
        "fastapi>=0.110.0",
        "uvicorn[standard]>=0.29.0",
        "websockets>=12.0",
        "pydantic>=2.7.0",
        "pydantic-settings>=2.2.0",
        "httpx>=0.27.0",
        "transformers>=4.40.0",
        "bitsandbytes>=0.43.0",
        "accelerate>=0.30.0",
        "sentencepiece>=0.2.0",
        "jinja2>=3.1.0",
        "aiosqlite>=0.20.0",
        "pyngrok>=7.0.0",
    ]

    cmd = [sys.executable, "-m", "pip", "install", "--quiet"] + deps
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        # Try with --user flag (Kaggle sometimes needs this)
        cmd.insert(3, "--user")
        result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode == 0:
        print("   Dependencies installed successfully")
    else:
        print(f"   WARNING: Some packages may have failed: {result.stderr[:200]}")


# =============================================================================
# STEP 2: Verify GPU
# =============================================================================
def verify_gpu():
    """Check GPU availability and print info."""
    print("\n[2/6] Verifying GPU...")

    try:
        import torch
        if torch.cuda.is_available():
            gpu_name = torch.cuda.get_device_name(0)
            vram = torch.cuda.get_device_properties(0).total_memory / 1e9
            print(f"   GPU: {gpu_name}")
            print(f"   VRAM: {vram:.1f} GB")
            if vram < 14:
                print("   WARNING: Less than 14GB VRAM. Model may not fit.")
            return True
        else:
            print("   WARNING: No GPU detected. LLM will not load.")
            print("   Go to Runtime → Change runtime type → T4 GPU")
            return False
    except ImportError:
        print("   WARNING: PyTorch not available")
        return False


# =============================================================================
# STEP 3: Setup project files
# =============================================================================
def setup_project():
    """Ensure all server files are in place."""
    print("\n[3/6] Setting up project files...")

    # Determine working directory
    if ENV == "colab":
        base = Path("/content/server")
        if not base.exists():
            base = Path("/content/PrivacyLens/server")
    elif ENV == "kaggle":
        base = Path("/kaggle/working/PrivacyLens/server")
    else:
        base = Path.cwd()

    # Check if server files exist
    required_files = [
        "main.py", "config.py", "requirements.txt",
        "schemas/messages.py", "schemas/actions.py", "schemas/protocols.py",
        "core/planner.py", "core/protocol_engine.py", "core/vlm_client.py",
        "models/llm_loader.py", "api/routes.py", "api/websocket_handler.py",
        "state/task_tracker.py", "state/session_manager.py", "state/memory_store.py",
    ]

    missing = []
    for f in required_files:
        if not (base / f).exists():
            missing.append(f)

    if missing:
        print(f"   Missing files: {missing}")
        print("   Please upload the server/ folder to the notebook.")
        print(f"   Expected location: {base}")
        return None

    print(f"   Project directory: {base}")
    return base


# =============================================================================
# STEP 4: Load LLM
# =============================================================================
def load_llm_model(project_dir):
    """Load Qwen3-14B with 4-bit quantization."""
    print("\n[4/6] Loading LLM (this takes 2-3 minutes on first run)...")

    sys.path.insert(0, str(project_dir))

    try:
        from models.llm_loader import load_llm

        model, tokenizer = load_llm(
            model_name=LLM_MODEL,
            device="cuda",
            load_in_4bit=True,
        )
        print("   LLM loaded successfully!")
        return True
    except Exception as e:
        print(f"   ERROR loading LLM: {e}")
        print("   Server will run without LLM (plan generation will fail)")
        return False


# =============================================================================
# STEP 5: Start server
# =============================================================================
def start_server(project_dir):
    """Start the FastAPI server in a background thread."""
    print(f"\n[5/6] Starting server on port {SERVER_PORT}...")

    os.chdir(project_dir)

    def run():
        import uvicorn
        uvicorn.run(
            "main:app",
            host="0.0.0.0",
            port=SERVER_PORT,
            log_level="info",
        )

    server_thread = threading.Thread(target=run, daemon=True)
    server_thread.start()

    # Wait for server to start
    for i in range(10):
        time.sleep(1)
        try:
            import httpx
            resp = httpx.get(f"http://localhost:{SERVER_PORT}/api/health", timeout=5)
            if resp.status_code == 200:
                print(f"   Server running at http://localhost:{SERVER_PORT}")
                print(f"   API docs at http://localhost:{SERVER_PORT}/docs")
                return True
        except Exception:
            continue

    print("   WARNING: Server may not have started yet. Check logs.")
    return False


# =============================================================================
# STEP 6: Expose via ngrok
# =============================================================================
def setup_ngrok():
    """Expose server via ngrok tunnel."""
    print("\n[6/6] Setting up ngrok tunnel...")

    global NGROK_AUTH_TOKEN

    # Prompt for token if not set (Colab interactive input)
    if not NGROK_AUTH_TOKEN:
        NGROK_AUTH_TOKEN = input("   Enter your ngrok auth token (get free at ngrok.com): ").strip()
        if not NGROK_AUTH_TOKEN:
            print("   No ngrok token provided. Skipping tunnel.")
            print(f"   Use locally: ws://localhost:{SERVER_PORT}/ws/browser-agent")
            return None

    try:
        from pyngrok import ngrok, conf

        # Set auth token if provided
        if NGROK_AUTH_TOKEN:
            conf.get_default().auth_token = NGROK_AUTH_TOKEN

        # Create tunnel
        tunnel = ngrok.connect(SERVER_PORT)
        public_url = tunnel.public_url
        ws_url = public_url.replace("https", "wss")

        print(f"\n   {'='*60}")
        print(f"   SERVER IS LIVE!")
        print(f"   {'='*60}")
        print(f"   Public URL:  {public_url}")
        print(f"   WebSocket:   {ws_url}/ws/browser-agent")
        print(f"   Health:      {public_url}/api/health")
        print(f"   API docs:    {public_url}/docs")
        print(f"   {'='*60}")
        print(f"\n   Copy this WebSocket URL into your extension config:")
        print(f"   {ws_url}/ws/browser-agent")

        return public_url

    except Exception as e:
        print(f"   ngrok failed: {e}")
        print(f"\n   ALTERNATIVE: Use this URL directly (if on same network):")
        print(f"   ws://localhost:{SERVER_PORT}/ws/browser-agent")
        return None


# =============================================================================
# MAIN
# =============================================================================
def main():
    print("=" * 60)
    print("  PrivacyLens LLM Server — Setup")
    print(f"  Environment: {ENV.upper()}")
    print("=" * 60)

    # Step 1: Install deps
    install_deps()

    # Step 2: Verify GPU
    has_gpu = verify_gpu()

    # Step 3: Setup project
    project_dir = setup_project()
    if project_dir is None:
        print("\nFIX: Upload the server/ folder and re-run this script.")
        return

    # Step 4: Load LLM
    llm_loaded = False
    if has_gpu:
        llm_loaded = load_llm_model(project_dir)

    # Step 5: Start server
    server_ok = start_server(project_dir)

    # Step 6: ngrok
    if server_ok:
        public_url = setup_ngrok()
    else:
        print("\nServer did not start. Check error messages above.")

    # Summary
    print(f"\n{'='*60}")
    print("  SETUP COMPLETE")
    print(f"{'='*60}")
    print(f"  Environment:  {ENV.upper()}")
    print(f"  GPU:          {'Yes' if has_gpu else 'No'}")
    print(f"  LLM loaded:   {'Yes' if llm_loaded else 'No'}")
    print(f"  Server:       {'Running' if server_ok else 'Not running'}")
    print(f"{'='*60}")

    if not llm_loaded:
        print("\n  NOTE: LLM not loaded. Plan generation will fail.")
        print("  Make sure you're using a GPU runtime.")

    # Keep the cell alive so the server keeps running
    if server_ok:
        print("\n  Server is running. Press STOP to shut down.")
        try:
            while True:
                time.sleep(60)
        except KeyboardInterrupt:
            print("\n  Shutting down...")


if __name__ == "__main__":
    main()
