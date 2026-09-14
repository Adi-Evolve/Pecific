/**
 * iSIH / PrivacyLens — Agent Message Contract (WebSocket Protocol)
 * Shared between Extension Client (Dev 1 / Dev 3) and Server (Dev 5).
 */

// ─── Enums (Dev 1 Compatible) ──────────────────────────────────────────────────

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

// ─── String Union Types ────────────────────────────────────────────────────────

export type MessageType =
  | 'USER_QUERY'
  | 'STEP_RESULT'
  | 'APPROVAL_RESPONSE'
  | 'SESSION_RESTORE'
  | 'PAUSE_AGENT'
  | 'RESUME_AGENT'
  | 'STOP_AGENT'
  | 'PLAN'
  | 'NEXT_STEP'
  | 'APPROVAL_REQUIRED'
  | 'DYNAMIC_OBSTACLE'
  | 'SESSION_RESTORED'
  | 'TASK_COMPLETE'
  | 'ERROR';

export type ScreenType =
  | 'search_results'
  | 'product_detail'
  | 'checkout_cart'
  | 'login_auth'
  | 'form_application'
  | 'dashboard_home'
  | 'canvas_workspace'
  | 'captcha_challenge'
  | 'modal_overlay'
  | 'error_page'
  | 'unknown';

// ─── Bounding Box & Vision ──────────────────────────────────────────────────────

export interface BoundingBox {
  bbox: [number, number, number, number]; // [x, y, width, height]
  confidence?: number;
  label?: string;
}

export interface VisionContext {
  screen_type: ScreenType;
  confidence: number;
  layout?: {
    visual_density?: 'low' | 'medium' | 'high';
    has_active_modal?: boolean;
    has_sticky_footer?: boolean;
    canvas_heavy?: boolean;
  };
  detected_regions?: Array<{
    type: string;
    bbox: [number, number, number, number];
    label?: string;
  }>;
  faces_detected?: BoundingBox[];
  visual_pii_regions?: Array<{
    type: string;
    bbox: [number, number, number, number];
  }>;
}

// ─── Sanitized DOM ─────────────────────────────────────────────────────────────

export interface SanitizedElement {
  id: string;
  tag: string;
  selector?: string;
  text?: string;
  placeholder?: string;
  href?: string;
  type?: string;
  value?: string;
  interactive?: boolean;
  role?: string;
  coordinates?: [number, number, number, number];
  is_redacted?: boolean;
  redacted_types?: string[];
  redacted_tokens?: string[];
}

export interface SanitizedDOM {
  elements_count: number;
  elements: SanitizedElement[];
  forms?: Array<{
    id?: string;
    action?: string;
    method?: string;
    inputs: string[];
  }>;
  viewport?: {
    width: number;
    height: number;
    scroll_x: number;
    scroll_y: number;
  };
}

// ─── Vault Manifest ────────────────────────────────────────────────────────────

export interface VaultManifest {
  has_email?: boolean;
  has_password?: boolean;
  has_phone?: boolean;
  has_card?: boolean;
  has_aadhaar?: boolean;
  has_pan?: boolean;
  locked?: boolean;
  tokens_available?: string[];
  tokens_count?: number;
  token_types?: Record<string, string>;
  redacted_elements?: Array<{
    element_id: string;
    tag: string;
    selector?: string;
    types: string[];
    tokens: string[];
  }>;
}

// ─── Action & Execution ────────────────────────────────────────────────────────

export interface ActionStep {
  step_id?: number;
  action_id?: string;
  action: string;
  selector?: string;
  value?: string;
  description?: string;
  risk_level?: 'SAFE' | 'CAUTION' | 'CRITICAL';
  riskLevel?: 'SAFE' | 'CAUTION' | 'CRITICAL';
  use_vault?: boolean;
  useVault?: boolean;
  vault_key?: string;
  coordinates?: [number, number];
}

export interface ExecutionPlan {
  goal: string;
  total_steps?: number;
  steps: Array<ActionStep | string>;
}

// ─── Payloads ──────────────────────────────────────────────────────────────────

export interface UserQueryPayload {
  query: string;
  url?: string;
  viewport?: { width: number; height: number };
}

export interface StepResultPayload {
  success: boolean;
  step_id?: number;
  actionId?: string;
  action?: string;
  sanitized_dom?: SanitizedDOM;
  domSnapshot?: any;
  vision_context?: VisionContext;
  visionContext?: any;
  redacted_screenshot?: string;
  vault_manifest?: VaultManifest;
  error?: string;
}

export interface PlanPayload {
  goal?: string;
  plan?: ExecutionPlan;
  steps?: string[];
}

export interface NextStepPayload {
  step?: ActionStep;
  actionId?: string;
  action?: any;
}

export interface ApprovalRequiredPayload {
  step?: ActionStep;
  actionId?: string;
  description?: string;
  reason?: string;
  riskLevel?: 'SAFE' | 'CAUTION' | 'CRITICAL';
  vault_key?: string;
}

export interface ApprovalResponsePayload {
  step_id?: number;
  actionId?: string;
  action?: string;
  approved: boolean;
  useVault?: boolean;
  client_timestamp?: number;
}

export interface TaskCompletePayload {
  summary: string;
  steps_completed: number;
  total: number;
  extracted_data?: any[];
}

export interface ErrorPayload {
  code: string;
  message: string;
}

// ─── Base Envelope ─────────────────────────────────────────────────────────────

export interface AgentMessage<T = any> {
  type: MessageType | ExtensionToServerMessageType | ServerToExtensionMessageType;
  session_id?: string;
  timestamp?: string; // ISO string
  client_timestamp?: number;
  payload: T;
}
