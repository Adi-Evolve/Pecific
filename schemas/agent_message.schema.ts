export enum ExtensionToServerMessageType {
  USER_QUERY = 'USER_QUERY',
  STEP_RESULT = 'STEP_RESULT',
  APPROVAL_RESPONSE = 'APPROVAL_RESPONSE',
  SESSION_RESTORE = 'SESSION_RESTORE',
  PAUSE_AGENT = 'PAUSE_AGENT',
  RESUME_AGENT = 'RESUME_AGENT',
  STOP_AGENT = 'STOP_AGENT'
}

export enum ServerToExtensionMessageType {
  PLAN = 'PLAN',
  NEXT_STEP = 'NEXT_STEP',
  APPROVAL_REQUIRED = 'APPROVAL_REQUIRED',
  DYNAMIC_OBSTACLE = 'DYNAMIC_OBSTACLE',
  SESSION_RESTORED = 'SESSION_RESTORED',
  TASK_COMPLETE = 'TASK_COMPLETE',
  ERROR = 'ERROR'
}

// Base Envelope
export interface AgentMessage {
  type: ExtensionToServerMessageType | ServerToExtensionMessageType;
  timestamp: string; // ISO string
  payload: any;
}

// Specific Extension -> Server Payloads
export interface UserQueryPayload {
  query: string;
}

export interface StepResultPayload {
  success: boolean;
  actionId: string;
  domSnapshot?: any; // To be typed by R2 (dom_snapshot.schema.json)
  visionContext?: any; // To be typed by R4 (vision_context.schema.json)
}

export interface ApprovalResponsePayload {
  approved: boolean;
  actionId: string;
}

// Specific Server -> Extension Payloads
export interface PlanPayload {
  goal: string;
  steps: string[];
}

export interface NextStepPayload {
  actionId: string;
  action: any; // To be typed by R5 (action.schema.json)
}

export interface ApprovalRequiredPayload {
  actionId: string;
  description: string;
  riskLevel: 'SAFE' | 'CAUTION' | 'CRITICAL';
}

export interface ErrorPayload {
  code: string;
  message: string;
}
