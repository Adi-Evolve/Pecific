/**
 * iSIH / PrivacyLens — Agent Message Contract (WebSocket Protocol)
 * Shared between Extension Client (R1) and Server (R5).
 */

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

export interface VaultManifest {
  has_email?: boolean;
  has_password?: boolean;
  has_phone?: boolean;
  has_address?: boolean;
  has_pan?: boolean;
  has_aadhaar?: boolean;
  has_card?: boolean;
}

export interface PrivacyStats {
  faces_redacted: number;
  pii_tokens_masked: number;
  dom_masked_fields: number;
}

export interface TokenManifest {
  tokens_used: string[];
  total_tokens: number;
  token_types?: Record<string, string>;
  redacted_elements?: Array<{
    element_id: string;
    tag?: string;
    selector?: string;
    types: string[];
    tokens: string[];
  }>;
}

export interface UserQueryPayload {
  query: string;
  current_url: string;
  page_title?: string;
  viewport?: { width: number; height: number; scroll_x: number; scroll_y: number };
  sanitized_dom: SanitizedDOM;
  vision_context: VisionContext;
  vault_manifest: VaultManifest;
  redacted_screenshot?: string; // base64 data URL
  privacy_stats?: PrivacyStats;
  token_manifest?: TokenManifest;
}

export interface StepResultPayload {
  step_id: number;
  action: string;
  status: 'success' | 'error' | 'skipped';
  current_url: string;
  vision_context?: VisionContext;
  result?: Record<string, any>;
  redacted_screenshot?: string;
  extracted_data?: any;
}

export interface ActionStep {
  id: number;
  action:
    | 'NAVIGATE'
    | 'CLICK'
    | 'TYPE'
    | 'TYPE_FROM_VAULT'
    | 'PRESS_KEY'
    | 'HOVER'
    | 'SCROLL'
    | 'SELECT'
    | 'WAIT'
    | 'SCREENSHOT'
    | 'EXTRACT'
    | 'NEW_TAB'
    | 'SWITCH_TAB'
    | 'CLOSE_TAB'
    | 'DISMISS_POPUP'
    | 'CAPTCHA_HANDOFF'
    | 'REPORT_RESULT';
  target?: {
    selector?: string;
    url?: string;
    coordinates?: [number, number];
    text?: string;
    tab_id?: number;
    tab_purpose?: string;
  };
  value?: string;
  key?: string;
  vault_key?: string;
  execution_mode?: 'DOM' | 'VISION' | 'HYBRID';
  protocol_level?: 'SAFE' | 'CAUTION' | 'CRITICAL' | 'FORBIDDEN';
  description?: string;
  verify?: {
    method: 'DOM_CHECK' | 'URL_CHECK' | 'SCREENSHOT';
    condition: string;
  };
  fallback?: {
    action: string;
    reason: string;
  };
  timeout_ms?: number;
}

export interface ExecutionPlan {
  goal: string;
  chain_of_thought?: string;
  total_steps: number;
  steps: ActionStep[];
}

export interface PlanPayload {
  plan: ExecutionPlan;
}

export interface NextStepPayload {
  step: ActionStep;
}

export interface ApprovalRequiredPayload {
  step: ActionStep;
  reason: string;
  vault_key?: string;
}

export interface ApprovalResponsePayload {
  step_id: number;
  action: string;
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

export interface AgentMessage<T = any> {
  type: MessageType;
  session_id: string;
  client_timestamp?: number;
  payload: T;
}
