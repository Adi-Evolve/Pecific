import asyncio
import inspect
import json
import os
import sys
import websockets

DEFAULT_URL = os.environ.get(
    "WS_URL",
    sys.argv[1] if len(sys.argv) > 1 else "ws://localhost:8000/ws/browser-agent"
)
WS_URL = DEFAULT_URL
SESSION_ID = "session_test_smoke_001"

async def smoke_test(url: str = WS_URL):
    print(f"Connecting to {url}...")
    
    connect_kwargs = {"open_timeout": 15}
    sig = inspect.signature(websockets.connect)
    if "additional_headers" in sig.parameters:
        connect_kwargs["additional_headers"] = {"ngrok-skip-browser-warning": "true"}
    elif "extra_headers" in sig.parameters:
        connect_kwargs["extra_headers"] = {"ngrok-skip-browser-warning": "true"}
    
    async with websockets.connect(url, **connect_kwargs) as ws:
        print("Connected!")

        user_query = {
            "type": "USER_QUERY",
            "session_id": SESSION_ID,
            "payload": {
                "query": "Search for Sony WH-1000XM5 on Flipkart and extract the price",
                "url": "https://www.flipkart.com",
                "viewport": {"width": 1280, "height": 720}
            }
        }
        print("[CLIENT] Sending USER_QUERY")
        await ws.send(json.dumps(user_query))

        step_result = {
            "type": "STEP_RESULT",
            "session_id": SESSION_ID,
            "payload": {
                "success": True,
                "sanitized_dom": {
                    "url": "https://www.flipkart.com",
                    "title": "Flipkart",
                    "viewport": {"width": 1280, "height": 720},
                    "elements": [
                        {"id": 1, "tag": "INPUT", "type": "text", "role": "searchbox", "selector": "input[name='q']", "text": "", "placeholder": "Search for products", "rect": [245, 18, 580, 48]},
                        {"id": 2, "tag": "BUTTON", "role": "button", "selector": "button[type='submit']", "text": "Search", "rect": [830, 18, 100, 48]},
                    ],
                    "forms": []
                },
                "vault_manifest": {"fields": {"email": False, "password": False}, "locked": False},
                "redacted_screenshot": None
            }
        }
        print("[CLIENT] Sending STEP_RESULT with 2 DOM elements")
        await ws.send(json.dumps(step_result))

        print("\n[CLIENT] Waiting for responses (up to 5 min)...\n")
        
        for i in range(10):
            try:
                response = await asyncio.wait_for(ws.recv(), timeout=60.0)
                msg = json.loads(response)
                msg_type = msg.get("type", "UNKNOWN")
                print(f"[SERVER] {msg_type}: {json.dumps(msg.get('payload', {}), indent=2)[:500]}")
                
                if msg_type == "PLAN":
                    print("\n*** PLAN RECEIVED! Server is fully working! ***")
                    return True
                elif msg_type == "ERROR":
                    print(f"\n*** ERROR: {msg['payload']} ***")
                    return False
                    
            except asyncio.TimeoutError:
                print(f"[CLIENT] Timeout on message {i+1}")
                continue

        print("\n*** TIMEOUT: No PLAN received ***")
        return False

if __name__ == "__main__":
    result = asyncio.run(smoke_test())
    print(f"\nResult: {'PASS' if result else 'FAIL'}")
