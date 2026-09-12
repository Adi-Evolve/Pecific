{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "WebSocket Envelope",
  "description": "Standard WebSocket message envelope shared between Extension and LLM Server. Co-owned by Dev 1 and Dev 5.",
  "type": "object",
  "required": ["type", "session_id", "payload"],
  "properties": {
    "type": {
      "type": "string",
      "enum": [
        "USER_QUERY",
        "STEP_RESULT",
        "APPROVAL_RESPONSE",
        "SESSION_RESTORE",
        "PAUSE_AGENT",
        "RESUME_AGENT",
        "STOP_AGENT",
        "PLAN",
        "NEXT_STEP",
        "APPROVAL_REQUIRED",
        "DYNAMIC_OBSTACLE",
        "SESSION_RESTORED",
        "TASK_COMPLETE",
        "ERROR"
      ],
      "description": "Action or event verb. Must be UPPER_SNAKE_CASE from this enum."
    },
    "session_id": {
      "type": "string",
      "pattern": "^sess_[0-9]+_[a-zA-Z0-9]+$",
      "description": "Unique session identifier, e.g. sess_1726051200_abc"
    },
    "client_timestamp": {
      "type": "number",
      "description": "Milliseconds since Unix epoch (optional on server-to-client messages)"
    },
    "payload": {
      "type": "object",
      "description": "Data specific to the message type. Shape varies per type."
    }
  },
  "additionalProperties": false
}
