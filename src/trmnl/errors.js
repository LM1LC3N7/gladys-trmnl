// -----------------------------------------------------------------------------
// One error type for everything TRMNL can answer, with a kind the app decides
// on. Messages never carry the API key nor an answer body.
// -----------------------------------------------------------------------------

export const KINDS = Object.freeze({
  /** Nothing reached TRMNL (connection refused, unknown name...): nothing was sent. */
  UNREACHABLE: 'unreachable',
  /** The request may have reached TRMNL but no answer came in time. */
  NO_ANSWER: 'no_answer',
  /** 401 or 403: the API key is refused. */
  AUTH: 'auth',
  /** 404 (a display that is not, or no longer, in the account). */
  NOT_FOUND: 'not_found',
  /** 429, with `retryAfterMs` when the answer said it. */
  RATE_LIMITED: 'rate_limited',
  /** 5xx, with `retryAfterMs` when the answer said it. */
  UNAVAILABLE: 'unavailable',
  /** Any other status (a redirect included: never followed). */
  HTTP: 'http',
  /** An answer that is not what the API documents. */
  BAD_RESPONSE: 'bad_response',
});

export class TrmnlError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'TrmnlError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

export const isBusy = (err) => err?.kind === KINDS.RATE_LIMITED;
export const isServerError = (err) => err?.kind === KINDS.UNAVAILABLE;
export const isKeyRefused = (err) => err?.kind === KINDS.AUTH;
/** Nothing of the request left: it is safe to say "not sent". */
export const notSent = (err) => err?.kind === KINDS.UNREACHABLE;
