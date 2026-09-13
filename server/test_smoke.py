"""Quick smoke test against live Colab server."""
import asyncio
import json
import websockets

WS_URL = "wss://unsoporiferous-ruinously-gertie.ngrok-free.dev/ws/browser-agent"
SESSION_ID = "session_test_smoke_001"

async def smoke_test():
    print(f"Connecting to {WS_URL}...")
    
    extra_headers = {"ngrok-skip-browser-warning": "true"}
    
    async with websockets.connect(WS_URL, extra_headers=extra_headers, open_timeout=15) as ws:
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
