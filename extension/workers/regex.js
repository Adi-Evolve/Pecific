/**
 * regex.js — Deterministic PII Scanner
 * PrivacyLens Privacy Engine (Dev 3 — R3)
 * 
 * Catches all structured/pattern-based PII with near-100% precision.
 * Includes smart exclusion rules to avoid false positives on brand names,
 * customer support numbers, navigation text, etc.
 * 
 * Supports Indian-specific PII: Aadhaar, PAN, UPI, IFSC
 * 
 * @module regex
 */

// ─── PII Type Constants ────────────────────────────────────────────────────────

export const PII_TYPES = {
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
  AADHAAR: 'AADHAAR',
  PAN: 'PAN',
  CREDIT_CARD: 'CARD',
  DOB: 'DOB',
  IP_ADDRESS: 'IP',
  UPI: 'UPI',
  IFSC: 'IFSC',
  PASSPORT: 'PASSPORT',
  PASSWORD_FIELD: 'PASSWORD_FIELD',
  OTP: 'OTP',
  NAME: 'NAME',
  ADDRESS: 'ADDRESS',
  AVATAR: 'AVATAR',
  SSN: 'SSN',
  VOTER_ID: 'VOTER_ID',
  DRIVING_LICENSE: 'DL',
  EPFO_UAN: 'EPFO_UAN',
  VEHICLE_RC: 'VEHICLE_RC',
  BANK_ACCOUNT: 'BANK_ACCOUNT',
};

// ─── Compiled Regex Patterns ────────────────────────────────────────────────────

const PATTERNS = {
  // Email: standard format, but we'll filter out system/support emails in post-processing
  EMAIL: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g,

  // Indian phone: optional +91/0 prefix, starts with 6-9, 10 digits total
  PHONE_INDIAN: /(?:(?:\+91[\s\-]?)|(?:0))?([6-9]\d{4}[\s\-]?\d{5})\b/g,

  // International phone: +<country_code> followed by digits (basic catch-all)
  PHONE_INTL: /\+(?!91\b)\d{1,3}[\s\-]?\d{6,14}\b/g,

  // Aadhaar: 12 digits, first digit 2-9, grouped as XXXX XXXX XXXX or continuous
  AADHAAR: /\b[2-9]\d{3}[\s\-]?\d{4}[\s\-]?\d{4}\b/g,

  // PAN: 5 letters + 4 digits + 1 letter (case-insensitive)
  // 4th character is category: P(Person), C(Company), H(HUF), F(Firm), A(AOP), T(Trust), B(BOI), L(Local Auth), J(AJP), G(Govt)
  PAN: /\b[a-zA-Z]{3}[PCGHFATBLJpcghfatblj][a-zA-Z]\d{4}[a-zA-Z]\b/g,

  // Credit card: 13-19 digits with optional separators (Luhn-validated in post-processing)
  CREDIT_CARD: /\b(?:\d{4}[\s\-]?){2,3}\d{1,4}(?:[\s\-]?\d{1,4})?\b/g,

  // Date of Birth: DD/MM/YYYY or DD-MM-YYYY or MM/DD/YYYY (contextual — only near DOB labels)
  DOB: /\b(?:0[1-9]|[12]\d|3[01])[\/\-](?:0[1-9]|1[0-2])[\/\-](?:19|20)\d{2}\b/g,

  // IPv4 address
  IP_V4: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,

  // UPI ID: <handle>@<provider> — distinguished from email by provider list
  UPI: /\b[a-zA-Z0-9._\-]+@(?:upi|ybl|paytm|oksbi|okhdfcbank|okaxis|okicici|axl|ibl|sbi|hdfcbank|icici|kotak|apl|boi|cbin|cnrb|allbank|axisbank|freecharge|indianbank|indus|iob|jkb|kbl|kvb|mahb|pnb|rbl|sib|ubi|uboi|united|vijb|yes)\b/gi,

  // IFSC Code: 4 letters + 0 + 6 alphanumeric
  IFSC: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g,

  // Indian Passport: 1 uppercase letter + 7 digits (contextual — only near "passport" labels)
  PASSPORT: /\b[A-Z]\d{7}\b/g,

  // Voter ID (EPIC): 3 uppercase letters + optional separator + 7 digits
  VOTER_ID: /\b[A-Z]{3}[\s\/-]?\d{7}\b/g,

  // Indian Driving License (Parivahan standard): e.g. DL-0420110012345 or MH02 20180012345 or KA0120190001234
  DRIVING_LICENSE: /\b[A-Z]{2}[-\s]?[0-9]{2}[-\s]?(?:19|20)[0-9]{2}[-\s]?[0-9]{7}\b|\b[A-Z]{2}[0-9]{13}\b/g,

  // EPFO UAN: 12-digit universal account number
  EPFO_UAN: /\b\d{12}\b/g,

  // Vehicle Registration (RC): Indian plate format (e.g. DL 01 AB 1234) or Bharat series (22 BH 1234 AA)
  VEHICLE_RC: /\b[A-Z]{2}[-\s]?[0-9]{1,2}[-\s]?[A-Z]{1,3}[-\s]?[0-9]{4}\b|\b[0-9]{2}[-\s]?BH[-\s]?[0-9]{4}[-\s]?[A-Z]{1,2}\b/g,

  // Indian Bank Account Number: 9 to 18 digits (contextual)
  BANK_ACCOUNT: /\b\d{9,18}\b/g,

  // SSN (US format, included for completeness): XXX-XX-XXXX
  SSN: /\b\d{3}[\-]\d{2}[\-]\d{4}\b/g,
};

// ─── Smart Exclusion Rules ──────────────────────────────────────────────────────

/** System/support email prefixes that are not personal PII */
const NON_PERSONAL_EMAIL_PREFIXES = new Set([
  'noreply', 'no-reply', 'no_reply',
  'support', 'help', 'helpdesk',
  'info', 'information',
  'admin', 'administrator', 'webmaster', 'postmaster',
  'contact', 'contactus', 'contact-us',
  'feedback', 'suggestions',
  'sales', 'marketing', 'team',
  'hello', 'hi',
  'newsletter', 'notifications', 'alerts',
  'mailer-daemon', 'daemon',
  'donotreply', 'do-not-reply', 'do_not_reply',
  'privacy', 'security', 'abuse', 'legal', 'compliance',
  'billing', 'invoice', 'accounts',
  'service', 'services', 'system',
  'recruitment', 'hr', 'careers', 'jobs',
]);

/** Known UPI provider domains — used to distinguish UPI IDs from emails */
const UPI_PROVIDERS = new Set([
  'upi', 'ybl', 'paytm', 'oksbi', 'okhdfcbank', 'okaxis', 'okicici',
  'axl', 'ibl', 'sbi', 'hdfcbank', 'icici', 'kotak', 'apl', 'boi',
  'cbin', 'cnrb', 'allbank', 'axisbank', 'freecharge', 'indianbank',
  'indus', 'iob', 'jkb', 'kbl', 'kvb', 'mahb', 'pnb', 'rbl', 'sib',
  'ubi', 'uboi', 'united', 'vijb', 'yes',
]);

/** Toll-free / emergency numbers to skip */
const SKIP_PHONE_PATTERNS = [
  /^1800/, /^1860/,        // Toll-free
  /^100$/, /^101$/, /^102$/, /^103$/, /^104$/, /^108$/, /^112$/, /^181$/, /^1098$/, // Emergency
];

/** Phone context labels suggesting it's a company/support phone, not personal */
const SKIP_PHONE_LABELS = new Set([
  'helpline', 'customer care', 'toll free', 'toll-free', 'tollfree',
  'call us', 'contact us', 'reach us', 'dial', 'enquiry', 'enquiries',
  'customer service', 'customer support', 'grievance',
]);

/** DOB context labels that trigger DOB detection (without these, date patterns are skipped) */
const DOB_LABELS = new Set([
  'dob', 'date of birth', 'birthday', 'birth date', 'birthdate',
  'born on', 'born', 'd.o.b', 'd.o.b.',
]);

/** Passport context labels */
const PASSPORT_LABELS = new Set([
  'passport', 'passport number', 'passport no', 'passport #',
  'travel document', 'passport id',
]);

/** OTP / Verification code labels */
const OTP_LABELS = new Set([
  'otp', 'verification code', 'verify', 'one-time password', 'security code',
  'passcode', 'verification', 'auth code', 'enter code', 'your code',
]);

/** Voter ID context labels */
const VOTER_ID_LABELS = new Set([
  'voter', 'voter id', 'epic', 'epic no', 'elector photo identity', 'election card', 'voter card',
]);

/** Driving License context labels */
const DL_LABELS = new Set([
  'dl', 'driving license', 'driving licence', 'd/l', 'licence no', 'license no', 'dl no', 'driver license',
]);

/** EPFO UAN context labels */
const UAN_LABELS = new Set([
  'uan', 'universal account number', 'epfo', 'pf number', 'pf no', 'provident fund', 'member id',
]);

/** Vehicle Registration / RC context labels */
const VEHICLE_RC_LABELS = new Set([
  'vehicle', 'rc', 'registration', 'reg no', 'plate', 'car no', 'bike no', 'chassis', 'motor', 'vehicle no',
]);

/** Indian Bank Account context labels */
const BANK_ACCOUNT_LABELS = new Set([
  'account number', 'account no', 'a/c no', 'a/c number', 'ac no', 'bank account', 'saving account', 'savings account', 'current account', 'a/c #', 'acct no', 'account #', 'bank a/c',
]);

/** Valid Indian State / Union Territory 2-letter codes */
const INDIAN_STATE_CODES = new Set([
  'AN', 'AP', 'AR', 'AS', 'BR', 'CG', 'CH', 'DD', 'DN', 'DL',
  'GA', 'GJ', 'HR', 'HP', 'JH', 'JK', 'KA', 'KL', 'LA', 'LD',
  'MP', 'MH', 'MN', 'ML', 'MZ', 'NL', 'OD', 'OR', 'PB', 'PY',
  'RJ', 'SK', 'TN', 'TS', 'TR', 'UP', 'UK', 'UA', 'WB',
]);

/** Non-sensitive IPs to skip */
const SKIP_IPS = new Set([
  '0.0.0.0', '127.0.0.1', '255.255.255.0', '255.255.255.255',
  '192.168.0.1', '192.168.1.1', '10.0.0.1', '10.0.0.0',
  '172.16.0.0', '224.0.0.0', '169.254.0.0',
]);

/** Parent selectors indicating non-personal content */
const NON_PERSONAL_PARENT_SELECTORS = new Set([
  'footer', 'nav', 'header',
  'privacy-policy', 'terms', 'legal', 'tos',
  'cookie-banner', 'cookie-consent',
  'sitemap',
]);

// ─── Luhn Algorithm ─────────────────────────────────────────────────────────────

/**
 * Validate a credit card number using the Luhn algorithm.
 * @param {string} number - Digits-only string (spaces/dashes removed)
 * @returns {boolean} True if the number passes Luhn check
 */
function luhnCheck(number) {
  const digits = number.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let isEven = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i], 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

// ─── Helper Functions ───────────────────────────────────────────────────────────

/**
 * Check if a string is surrounded by longer digit sequences (avoids matching
 * substrings of product IDs, order numbers, etc.)
 */
function isPartOfLongerNumber(text, start, end) {
  const charBefore = start > 0 ? text[start - 1] : '';
  const charAfter = end < text.length ? text[end] : '';
  if (/\d/.test(charBefore) || /\d/.test(charAfter)) return true;

  // Also check if preceded or followed by a segmented digit group (e.g. " 9012" or "1234 ")
  const suffix = text.slice(end);
  if (/^[\s-]\d/.test(suffix)) return true;
  const prefix = text.slice(0, start);
  if (/\d[\s-]$/.test(prefix)) return true;

  return false;
}

/**
 * Normalize nearby label text for context matching
 */
function normalizeLabel(label) {
  if (!label) return '';
  return label.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

/**
 * Check if parent context suggests non-personal content
 */
function isNonPersonalContext(context) {
  if (!context) return false;
  const { parentTag, parentClass, parentId } = context;

  if (parentTag && NON_PERSONAL_PARENT_SELECTORS.has(parentTag.toLowerCase())) return true;

  const classStr = (parentClass || '').toLowerCase();
  const idStr = (parentId || '').toLowerCase();

  for (const sel of NON_PERSONAL_PARENT_SELECTORS) {
    if (classStr.includes(sel) || idStr.includes(sel)) return true;
  }

  return false;
}

/**
 * Check if any nearby labels match a set of context keywords
 */
function hasContextLabel(context, labelSet) {
  if (!context || !context.nearbyLabels) return false;
  const normalized = normalizeLabel(context.nearbyLabels);
  for (const label of labelSet) {
    if (normalized.includes(label)) return true;
  }
  return false;
}

// ─── Main Scanner ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} PIIMatch
 * @property {string} type - PII category (EMAIL, PHONE, AADHAAR, PAN, CARD, etc.)
 * @property {string} value - The matched text
 * @property {number} start - Start index in source text
 * @property {number} end - End index in source text
 * @property {number} confidence - Always 1.0 for regex matches
 * @property {string} method - Always 'REGEX'
 */

/**
 * Scan text for structured PII using regex patterns + smart exclusion rules.
 * 
 * @param {string} text - Raw text content from DOM or OCR
 * @param {object} [context={}] - DOM context for smart filtering
 * @param {string} [context.parentTag] - Parent element tag (e.g., 'FOOTER', 'FORM')
 * @param {string} [context.parentClass] - Parent element class string
 * @param {string} [context.parentId] - Parent element ID
 * @param {string} [context.nearbyLabels] - Nearby label text for contextual matching
 * @param {string} [context.inputType] - If from an input, its type attribute
 * @param {string} [context.autocomplete] - Autocomplete attribute value
 * @returns {PIIMatch[]} Array of detected PII matches
 */
export function scanRegexPII(text, context = {}) {
  if (!text || typeof text !== 'string' || text.length === 0) return [];

  /** @type {PIIMatch[]} */
  const matches = [];

  // Track matched ranges to avoid overlapping detections
  const matchedRanges = [];

  /**
   * Check if a range overlaps with already-matched ranges
   */
  function isOverlapping(start, end) {
    return matchedRanges.some(r => start < r.end && end > r.start);
  }

  function addMatch(type, value, start, end) {
    if (!isOverlapping(start, end)) {
      matches.push({
        type,
        value,
        start,
        end,
        confidence: 1.0,
        method: 'REGEX',
      });
      matchedRanges.push({ start, end });
    }
  }

  // ── 1. Password fields (DOM attribute-based, highest priority) ──────────
  if (context.inputType === 'password' || 
      (context.autocomplete && context.autocomplete.includes('password'))) {
    addMatch(PII_TYPES.PASSWORD_FIELD, '[hidden]', 0, text.length);
    // Don't scan further — the entire field content is sensitive
    return matches;
  }

  // ── 2. UPI IDs (before email to avoid misclassification) ───────────────
  {
    const re = new RegExp(PATTERNS.UPI.source, PATTERNS.UPI.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const upiId = m[0];
      const domain = upiId.split('@')[1]?.toLowerCase();
      if (domain && UPI_PROVIDERS.has(domain)) {
        addMatch(PII_TYPES.UPI, upiId, m.index, m.index + upiId.length);
      }
    }
  }

  // ── 3. Emails ──────────────────────────────────────────────────────────
  {
    const re = new RegExp(PATTERNS.EMAIL.source, PATTERNS.EMAIL.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const email = m[0];
      const start = m.index;
      const end = start + email.length;

      // Skip if already matched as UPI
      if (isOverlapping(start, end)) continue;

      // Check if it's a UPI ID (domain is a UPI provider)
      const domain = email.split('@')[1]?.toLowerCase()?.split('.')[0];
      if (UPI_PROVIDERS.has(domain)) continue;

      // Skip non-personal system emails
      const prefix = email.split('@')[0].toLowerCase();
      if (NON_PERSONAL_EMAIL_PREFIXES.has(prefix)) continue;

      // Skip emails in non-personal contexts (footer, privacy policy, etc.)
      if (isNonPersonalContext(context)) continue;

      addMatch(PII_TYPES.EMAIL, email, start, end);
    }
  }

  // ── 4. Credit Cards (Luhn-validated) — scan BEFORE Aadhaar ─────────────
  // Reason: 16-digit credit card numbers contain 12-digit substrings that
  // look like Aadhaar numbers. By matching credit cards first, the overlap
  // check in the Aadhaar scanner correctly skips those ranges.
  {
    const re = new RegExp(PATTERNS.CREDIT_CARD.source, PATTERNS.CREDIT_CARD.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = m[0];
      const digits = value.replace(/\D/g, '');
      const start = m.index;
      const end = start + value.length;

      // Must be 13-19 digits and pass Luhn
      if (digits.length < 13 || digits.length > 19) continue;
      if (!luhnCheck(digits)) continue;

      // Skip if already matched
      if (isOverlapping(start, end)) continue;

      // Must not be part of a longer number
      if (isPartOfLongerNumber(text, start, end)) continue;

      addMatch(PII_TYPES.CREDIT_CARD, value, start, end);
    }
  }

  // ── 5. Indian Bank Account Number (contextual) — Scan BEFORE Aadhaar ────
  // Reason: 12-digit bank accounts beginning with 2-9 look identical to Aadhaar numbers.
  // When bank account context labels are present, prioritize Bank Account detection.
  if (hasContextLabel(context, BANK_ACCOUNT_LABELS)) {
    const re = new RegExp(PATTERNS.BANK_ACCOUNT.source, PATTERNS.BANK_ACCOUNT.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = m[0];
      const start = m.index;
      const end = start + value.length;

      if (isOverlapping(start, end)) continue;
      if (isPartOfLongerNumber(text, start, end)) continue;

      addMatch(PII_TYPES.BANK_ACCOUNT, value, start, end);
    }
  }

  // ── 6. EPFO UAN (12-digit Universal Account Number, contextual) ────────
  // Reason: 12-digit UANs beginning with 2-9 must not be shadowed by Aadhaar.
  if (hasContextLabel(context, UAN_LABELS)) {
    const re = new RegExp(PATTERNS.EPFO_UAN.source, PATTERNS.EPFO_UAN.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = m[0];
      const start = m.index;
      const end = start + value.length;

      if (isOverlapping(start, end)) continue;
      if (isPartOfLongerNumber(text, start, end)) continue;

      addMatch(PII_TYPES.EPFO_UAN, value, start, end);
    }
  }

  // ── 7. Aadhaar (12 digits, Indian national ID) ─────────────────────────
  // Note: Only evaluated if element is not explicitly labeled as Bank Account or EPFO UAN
  if (!hasContextLabel(context, BANK_ACCOUNT_LABELS) && !hasContextLabel(context, UAN_LABELS)) {
    const re = new RegExp(PATTERNS.AADHAAR.source, PATTERNS.AADHAAR.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = m[0];
      const digits = value.replace(/\D/g, '');
      const start = m.index;
      const end = start + value.length;

      // Must be exactly 12 digits
      if (digits.length !== 12) continue;

      // Skip if overlapping with an already-matched credit card, bank account, or UAN
      if (isOverlapping(start, end)) continue;

      // Must not be part of a longer number
      if (isPartOfLongerNumber(text, start, end)) continue;

      // Skip all-same-digit patterns (not real Aadhaar)
      if (/^(\d)\1+$/.test(digits)) continue;

      addMatch(PII_TYPES.AADHAAR, value, start, end);
    }
  }

  // ── 8. PAN ─────────────────────────────────────────────────────────────
  {
    const re = new RegExp(PATTERNS.PAN.source, PATTERNS.PAN.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = m[0];
      const start = m.index;
      const end = start + value.length;

      // Must not be part of a longer alphanumeric string
      const charBefore = start > 0 ? text[start - 1] : ' ';
      const charAfter = end < text.length ? text[end] : ' ';
      if (/[A-Z0-9]/i.test(charBefore) || /[A-Z0-9]/i.test(charAfter)) continue;

      addMatch(PII_TYPES.PAN, value, start, end);
    }
  }

  // ── 9. Indian Phone Numbers ────────────────────────────────────────────
  {
    const re = new RegExp(PATTERNS.PHONE_INDIAN.source, PATTERNS.PHONE_INDIAN.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = m[0];
      const digits = value.replace(/\D/g, '');
      const start = m.index;
      const end = start + value.length;

      // Skip if already matched
      if (isOverlapping(start, end)) continue;

      // Must not be part of a longer digit sequence (e.g. order ID, tracking number)
      if (isPartOfLongerNumber(text, start, end)) continue;

      // Must not be preceded directly by an alphanumeric char (e.g. OD123456789012)
      const charBefore = start > 0 ? text[start - 1] : ' ';
      if (/[A-Za-z0-9]/.test(charBefore)) continue;

      // Skip toll-free and emergency numbers
      const isSkipPattern = SKIP_PHONE_PATTERNS.some(p => p.test(digits));
      if (isSkipPattern) continue;

      // Skip if context labels suggest it's a company/support number
      if (hasContextLabel(context, SKIP_PHONE_LABELS)) continue;

      // Skip if in footer/nav (usually customer care)
      if (context.parentTag && ['FOOTER', 'NAV'].includes(context.parentTag.toUpperCase())) {
        continue;
      }

      addMatch(PII_TYPES.PHONE, value, start, end);
    }
  }

  // ── 10. International Phone Numbers ─────────────────────────────────────
  {
    const re = new RegExp(PATTERNS.PHONE_INTL.source, PATTERNS.PHONE_INTL.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = m[0];
      const start = m.index;
      const end = start + value.length;

      if (isOverlapping(start, end)) continue;
      if (hasContextLabel(context, SKIP_PHONE_LABELS)) continue;

      addMatch(PII_TYPES.PHONE, value, start, end);
    }
  }

  // ── 11. IP Addresses ────────────────────────────────────────────────────
  {
    const re = new RegExp(PATTERNS.IP_V4.source, PATTERNS.IP_V4.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = m[0];
      const start = m.index;
      const end = start + value.length;

      if (isOverlapping(start, end)) continue;

      // Skip common non-sensitive IPs
      if (SKIP_IPS.has(value)) continue;

      // Validate octets are 0-255 (regex already does this, but double-check)
      const octets = value.split('.').map(Number);
      if (octets.some(o => o > 255)) continue;

      addMatch(PII_TYPES.IP_ADDRESS, value, start, end);
    }
  }

  // ── 12. IFSC Codes ────────────────────────────────────────────────────
  {
    const re = new RegExp(PATTERNS.IFSC.source, PATTERNS.IFSC.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = m[0];
      const start = m.index;
      const end = start + value.length;

      if (isOverlapping(start, end)) continue;

      // Must not be part of a longer alphanumeric sequence
      const charBefore = start > 0 ? text[start - 1] : ' ';
      const charAfter = end < text.length ? text[end] : ' ';
      if (/[A-Z0-9]/i.test(charBefore) || /[A-Z0-9]/i.test(charAfter)) continue;

      addMatch(PII_TYPES.IFSC, value, start, end);
    }
  }

  // ── 13. Dates of Birth (contextual — requires nearby DOB label) ──────
  if (hasContextLabel(context, DOB_LABELS)) {
    const re = new RegExp(PATTERNS.DOB.source, PATTERNS.DOB.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = m[0];
      const start = m.index;
      const end = start + value.length;

      if (isOverlapping(start, end)) continue;

      addMatch(PII_TYPES.DOB, value, start, end);
    }
  }

  // ── 14. Passport Numbers (contextual — requires nearby passport label) ─
  if (hasContextLabel(context, PASSPORT_LABELS)) {
    const re = new RegExp(PATTERNS.PASSPORT.source, PATTERNS.PASSPORT.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = m[0];
      const start = m.index;
      const end = start + value.length;

      if (isOverlapping(start, end)) continue;

      // Must not be part of a longer alphanumeric string
      const charBefore = start > 0 ? text[start - 1] : ' ';
      const charAfter = end < text.length ? text[end] : ' ';
      if (/[A-Z0-9]/i.test(charBefore) || /[A-Z0-9]/i.test(charAfter)) continue;

      addMatch(PII_TYPES.PASSPORT, value, start, end);
    }
  }

  // ── 15. OTP / Verification Codes (contextual — requires nearby OTP label) ──
  if (hasContextLabel(context, OTP_LABELS)) {
    const re = /\b\d{4,8}\b/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = m[0];
      const start = m.index;
      const end = start + value.length;

      if (isOverlapping(start, end)) continue;

      // Must not be part of a longer digit sequence
      const charBefore = start > 0 ? text[start - 1] : ' ';
      const charAfter = end < text.length ? text[end] : ' ';
      if (/\d/.test(charBefore) || /\d/.test(charAfter)) continue;

      addMatch(PII_TYPES.OTP, value, start, end);
    }
  }

  // ── 16. Voter ID (EPIC) ────────────────────────────────────────────────
  {
    const re = new RegExp(PATTERNS.VOTER_ID.source, PATTERNS.VOTER_ID.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = m[0];
      const start = m.index;
      const end = start + value.length;

      if (isOverlapping(start, end)) continue;

      // Must not be part of a longer alphanumeric string
      const charBefore = start > 0 ? text[start - 1] : ' ';
      const charAfter = end < text.length ? text[end] : ' ';
      if (/[A-Za-z0-9]/.test(charBefore) || /[A-Za-z0-9]/.test(charAfter)) continue;

      addMatch(PII_TYPES.VOTER_ID, value, start, end);
    }
  }

  // ── 17. Indian Driving License (DL) ────────────────────────────────────
  {
    const re = new RegExp(PATTERNS.DRIVING_LICENSE.source, PATTERNS.DRIVING_LICENSE.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = m[0];
      const start = m.index;
      const end = start + value.length;

      if (isOverlapping(start, end)) continue;

      // Must not be part of a longer alphanumeric string
      const charBefore = start > 0 ? text[start - 1] : ' ';
      const charAfter = end < text.length ? text[end] : ' ';
      if (/[A-Za-z0-9]/.test(charBefore) || /[A-Za-z0-9]/.test(charAfter)) continue;

      // Validate Indian state code or nearby DL context
      const stateCode = value.slice(0, 2).toUpperCase();
      if (INDIAN_STATE_CODES.has(stateCode) || hasContextLabel(context, DL_LABELS)) {
        addMatch(PII_TYPES.DRIVING_LICENSE, value, start, end);
      }
    }
  }

  // ── 18. Vehicle Registration (RC) ──────────────────────────────────────
  {
    const re = new RegExp(PATTERNS.VEHICLE_RC.source, PATTERNS.VEHICLE_RC.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = m[0];
      const start = m.index;
      const end = start + value.length;

      if (isOverlapping(start, end)) continue;

      const charBefore = start > 0 ? text[start - 1] : ' ';
      const charAfter = end < text.length ? text[end] : ' ';
      if (/[A-Za-z0-9]/.test(charBefore) || /[A-Za-z0-9]/.test(charAfter)) continue;

      const stateCode = value.slice(0, 2).toUpperCase();
      // Allow whitespace or hyphen in Bharat-series plates: e.g. 22 BH 1234 AA or 22-BH-1234-AA
      const isBH = /^\d{2}[-\s]?BH/i.test(value);
      if (INDIAN_STATE_CODES.has(stateCode) || isBH || hasContextLabel(context, VEHICLE_RC_LABELS)) {
        addMatch(PII_TYPES.VEHICLE_RC, value, start, end);
      }
    }
  }

  // Sort matches by position (start index)
  matches.sort((a, b) => a.start - b.start);

  return matches;
}

/**
 * Scan an array of DOM elements for PII, returning matches with element references.
 * 
 * @param {Array<{id: string, text?: string, placeholder?: string, tag: string, type?: string, parentTag?: string, parentClass?: string, nearbyLabels?: string, autocomplete?: string}>} elements
 * @returns {Array<{elementId: string, matches: PIIMatch[]}>}
 */
export function scanDOMElements(elements) {
  if (!Array.isArray(elements)) return [];

  const results = [];

  for (const el of elements) {
    const context = {
      parentTag: el.parentTag || el.tag,
      parentClass: el.parentClass || '',
      parentId: el.parentId || '',
      nearbyLabels: el.nearbyLabels || el.placeholder || '',
      inputType: el.type || '',
      autocomplete: el.autocomplete || '',
    };

    const textMatches = el.text ? scanRegexPII(el.text, context) : [];
    const placeholderMatches = el.placeholder ? scanRegexPII(el.placeholder, context) : [];
    const valueMatches = (el.value && el.type !== 'password') ? scanRegexPII(el.value, context) : [];

    // For password inputs, mark the whole element
    if (el.type === 'password') {
      textMatches.push({
        type: PII_TYPES.PASSWORD_FIELD,
        value: '[hidden]',
        start: 0,
        end: 0,
        confidence: 1.0,
        method: 'REGEX',
      });
    }

    // Contextual DOM attribute heuristics for form inputs:
    const labelContext = `${el.selector || ''} ${el.nearbyLabels || ''} ${el.placeholder || ''} ${el.id || ''}`.toLowerCase();

    // 1. Credit card input field
    if (el.value && /(?:addcreditcardnumber|card[-_\s]?number|credit[-_\s]?card)/i.test(labelContext)) {
      if (/\d{4}/.test(el.value) && !valueMatches.some(m => m.type === PII_TYPES.CREDIT_CARD)) {
        valueMatches.push({
          type: PII_TYPES.CREDIT_CARD,
          value: el.value.trim(),
          start: 0,
          end: el.value.trim().length,
          confidence: 0.95,
          method: 'DOM_ATTRIBUTE',
        });
      }
    }

    // 2. Cardholder nickname / name field
    if (el.value && /(?:cardholder|nickname|name\s*on\s*card|account\s*holder)/i.test(labelContext)) {
      if (/[a-zA-Z]{2,}/.test(el.value) && !valueMatches.some(m => m.type === PII_TYPES.NAME)) {
        valueMatches.push({
          type: PII_TYPES.NAME,
          value: el.value.trim(),
          start: 0,
          end: el.value.trim().length,
          confidence: 0.90,
          method: 'DOM_ATTRIBUTE',
        });
      }
    }

    // 3. Address container or input
    if (el.text && /(?:deliver(?:ing)? to|shipping address|delivery address|home address)/i.test(labelContext + ' ' + el.text)) {
      if (/(?:flat|building|path|chs|bazar|road|street|nagar|sector|\b\d{6}\b)/i.test(el.text) && !textMatches.some(m => m.type === PII_TYPES.ADDRESS)) {
        textMatches.push({
          type: PII_TYPES.ADDRESS,
          value: el.text.trim(),
          start: 0,
          end: el.text.trim().length,
          confidence: 0.95,
          method: 'DOM_ATTRIBUTE',
        });
      }
    }

    // 4. Greeting / Account user name: e.g. "Hello, Adi"
    if (el.text && /(?:nav[-_]?link[-_]?account|user[-_]?profile|account[-_]?list)/i.test(labelContext)) {
      const greetingMatch = el.text.match(/\b(?:hello|hi|welcome)[,\s]+([a-zA-Z]{2,})/i);
      if (greetingMatch && !textMatches.some(m => m.type === PII_TYPES.NAME)) {
        const nameVal = greetingMatch[1];
        const startIdx = el.text.indexOf(nameVal);
        textMatches.push({
          type: PII_TYPES.NAME,
          value: nameVal,
          start: startIdx,
          end: startIdx + nameVal.length,
          confidence: 0.85,
          method: 'DOM_ATTRIBUTE',
        });
      }
    }

    // 5. User profile image / avatar icon
    if (/(?:avatar|profile[-_]?image|profile[-_]?photo|profile[-_]?pic|user[-_]?avatar|account[-_]?avatar)/i.test(labelContext) ||
        (el.role === 'img' && /(?:avatar|profile|user)/i.test(labelContext))) {
      if (!textMatches.some(m => m.type === PII_TYPES.AVATAR)) {
        textMatches.push({
          type: PII_TYPES.AVATAR,
          value: el.text || '[USER_AVATAR]',
          start: 0,
          end: (el.text || '[USER_AVATAR]').length,
          confidence: 0.95,
          method: 'DOM_ATTRIBUTE',
        });
      }
    }

    // 6. First name / Last name / Full name / Instructor profile fields
    const targetVal = (el.value || el.text || '').trim();
    if (targetVal && /(?:first[-_\s]?name|last[-_\s]?name|full[-_\s]?name|given[-_\s]?name|family[-_\s]?name|instructor|faculty)/i.test(labelContext)) {
      if (/^[a-zA-Z\s.'-]{2,40}$/.test(targetVal) && !valueMatches.some(m => m.type === PII_TYPES.NAME) && !textMatches.some(m => m.type === PII_TYPES.NAME)) {
        const matchesList = el.value ? valueMatches : textMatches;
        matchesList.push({
          type: PII_TYPES.NAME,
          value: targetVal,
          start: 0,
          end: targetVal.length,
          confidence: 0.90,
          method: 'DOM_ATTRIBUTE',
        });
      }
    }

    // 7. Bank Account Number input field
    if (el.value && /(?:account[-_\s]?num|a\/c[-_\s]?no|acct[-_\s]?no|bank[-_\s]?acc)/i.test(labelContext)) {
      const cleanVal = el.value.replace(/\D/g, '');
      if (cleanVal.length >= 9 && cleanVal.length <= 18 && !valueMatches.some(m => m.type === PII_TYPES.BANK_ACCOUNT)) {
        valueMatches.push({
          type: PII_TYPES.BANK_ACCOUNT,
          value: el.value.trim(),
          start: 0,
          end: el.value.trim().length,
          confidence: 0.95,
          method: 'DOM_ATTRIBUTE',
        });
      }
    }

    // 8. Driving License input field
    if (el.value && /(?:driving[-_\s]?licen|dl[-_\s]?no|license[-_\s]?no)/i.test(labelContext)) {
      if (!valueMatches.some(m => m.type === PII_TYPES.DRIVING_LICENSE)) {
        valueMatches.push({
          type: PII_TYPES.DRIVING_LICENSE,
          value: el.value.trim(),
          start: 0,
          end: el.value.trim().length,
          confidence: 0.95,
          method: 'DOM_ATTRIBUTE',
        });
      }
    }

    // 9. Voter ID / EPIC input field
    if (el.value && /(?:voter[-_\s]?id|epic[-_\s]?no|election[-_\s]?card)/i.test(labelContext)) {
      if (!valueMatches.some(m => m.type === PII_TYPES.VOTER_ID)) {
        valueMatches.push({
          type: PII_TYPES.VOTER_ID,
          value: el.value.trim(),
          start: 0,
          end: el.value.trim().length,
          confidence: 0.95,
          method: 'DOM_ATTRIBUTE',
        });
      }
    }

    // 10. EPFO UAN input field
    if (el.value && /(?:epfo|uan[-_\s]?no|pf[-_\s]?number|provident[-_\s]?fund)/i.test(labelContext)) {
      const cleanVal = el.value.replace(/\D/g, '');
      if (cleanVal.length === 12 && !valueMatches.some(m => m.type === PII_TYPES.EPFO_UAN)) {
        valueMatches.push({
          type: PII_TYPES.EPFO_UAN,
          value: el.value.trim(),
          start: 0,
          end: el.value.trim().length,
          confidence: 0.95,
          method: 'DOM_ATTRIBUTE',
        });
      }
    }

    // 11. Vehicle Registration (RC) input field
    if (el.value && /(?:vehicle[-_\s]?reg|rc[-_\s]?no|registration[-_\s]?no|plate[-_\s]?no)/i.test(labelContext)) {
      if (!valueMatches.some(m => m.type === PII_TYPES.VEHICLE_RC)) {
        valueMatches.push({
          type: PII_TYPES.VEHICLE_RC,
          value: el.value.trim(),
          start: 0,
          end: el.value.trim().length,
          confidence: 0.95,
          method: 'DOM_ATTRIBUTE',
        });
      }
    }

    const allMatches = [...textMatches, ...placeholderMatches, ...valueMatches];
    if (allMatches.length > 0) {
      results.push({
        elementId: el.id,
        matches: allMatches,
      });
    }
  }

  return results;
}

// ─── Exported Utilities ─────────────────────────────────────────────────────────

export { luhnCheck, isPartOfLongerNumber };
