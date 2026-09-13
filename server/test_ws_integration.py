"""
Phase 4 WebSocket Integration Test
Simulates the extension's exact message flow to verify server compatibility.

Usage:
    1. Start the server: cd server && uvicorn main:app --reload --port 8000
    2. Run this script: python test_ws_integration.py
"""

import asyncio
import json
import websockets


WS_URL = "ws://127.0.0.1:8000/ws/browser-agent"  # Local test
SESSION_ID = "session_1726052000100"


async def test_full_flow():
    """Test the complete extension → server flow."""
    print(f"Connecting to {WS_URL}...")
    
    async with websockets.connect(WS_URL) as ws:
        print("Connected!\n")

        # --- Step 1: Send USER_QUERY (like extension does) ---
        user_query = {
            "type": "USER_QUERY",
            "session_id": SESSION_ID,
            "payload": {
                "query": "Search for Sony WH-1000XM5 on Flipkart and extract the price",
                "url": "https://www.flipkart.com",
                "viewport": {"width": 1280, "height": 720}
            }
        }
        print(f"[CLIENT] Sending USER_QUERY: {user_query['payload']['query']}")
        await ws.send(json.dumps(user_query))

        # --- Step 2: Send STEP_RESULT with sanitized DOM (like extension does) ---
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
                        {
                            "id": 1,
                            "tag": "INPUT",
                            "type": "text",
                            "role": "searchbox",
                            "selector": "input[name='q']",
                            "text": "",
                            "placeholder": "Search for products",
                            "rect": [245, 18, 580, 48]
                        },
                        {
                            "id": 2,
                            "tag": "BUTTON",
                            "role": "button",
                            "selector": "button[type='submit']",
                            "text": "Search",
                            "rect": [830, 18, 100, 48]
                        },
                        {
                            "id": 3,
                            "tag": "A",
                            "role": "link",
                            "selector": "a[href='/search?q=sony']",
                            "text": "Sony WH-1000XM5",
                            "rect": [120, 200, 350, 240]
                        },
                        {
                            "id": 4,
                            "tag": "SPAN",
                            "role": "text",
                            "selector": ".price",
                            "text": "₹24,990",
                            "rect": [120, 245, 200, 265]
                        }
                    ],
                    "forms": []
                },
                "vault_manifest": {
                    "fields": {
                        "email": False,
                        "password": False,
                        "phone": False
                    },
                    "locked": False
                },
                "redacted_screenshot": None
            }
        }
        print(f"[CLIENT] Sending STEP_RESULT with {len(step_result['payload']['sanitized_dom']['elements'])} DOM elements")
        await ws.send(json.dumps(step_result))

        # --- Step 3: Wait for server responses ---
        print("\n[SERVER] Waiting for responses...\n")
        
        for i in range(5):  # Expect PLAN + possibly NEXT_STEP or APPROVAL_REQUIRED
            try:
                response = await asyncio.wait_for(ws.recv(), timeout=300.0)
                msg = json.loads(response)
                msg_type = msg.get("type", "UNKNOWN")
                
                print(f"[SERVER] Received: {msg_type}")
                
                if msg_type == "PLAN":
                    plan = msg.get("payload", {}).get("plan", {})
                    steps = plan.get("steps", [])
                    print(f"  Goal: {plan.get('goal', 'N/A')}")
                    print(f"  Steps: {len(steps)}")
                    for step in steps:
                        print(f"    {step.get('id')}. {step.get('action')} - {step.get('description', '')[:60]}")
                        if step.get("target"):
                            print(f"       target: {step['target']}")
                
                elif msg_type == "NEXT_STEP":
                    step = msg.get("payload", {})
                    print(f"  Step {step.get('id')}: {step.get('action')}")
                    print(f"  Target: {step.get('target')}")
                    print(f"  Mode: {step.get('execution_mode', 'DOM')}")
                
                elif msg_type == "APPROVAL_REQUIRED":
                    step = msg.get("payload", {}).get("step", {})
                    print(f"  Step {step.get('id')}: {step.get('action')} - {step.get('description')}")
                    print(f"  Reason: {msg.get('payload', {}).get('reason', '')}")
                
                elif msg_type == "ERROR":
                    print(f"  Error: {msg.get('payload', {}).get('code', '')}: {msg.get('payload', {}).get('message', '')}")
                
                print()
                
            except asyncio.TimeoutError:
                print("[CLIENT] Timeout waiting for server response")
                break

        # --- Step 4: Simulate step execution result ---
        print("[CLIENT] Sending STEP_RESULT for step 1 (TYPE)...")
        step_complete = {
            "type": "STEP_RESULT",
            "session_id": SESSION_ID,
            "payload": {
                "step_id": 1,
                "success": True,
                "action": "TYPE"
            }
        }
        await ws.send(json.dumps(step_complete))

        # Wait for next step
        try:
            response = await asyncio.wait_for(ws.recv(), timeout=10.0)
            msg = json.loads(response)
            print(f"[SERVER] Received: {msg.get('type')}")
            if msg.get("type") == "NEXT_STEP":
                step = msg.get("payload", {})
                print(f"  Step {step.get('id')}: {step.get('action')}")
        except asyncio.TimeoutError:
            print("[CLIENT] Timeout")

        print("\n--- Test Complete ---")


if __name__ == "__main__":
    asyncio.run(test_full_flow())
