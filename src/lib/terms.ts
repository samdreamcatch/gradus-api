// Bump this when terms change to require re-acceptance.
export const CURRENT_TERMS_VERSION = "2026-06-29";

// localStorage key set on the signup form when the user checks the terms box,
// then consumed by the authed layout after the session lands.
export const PENDING_TERMS_ACCEPT_KEY = "gradus.pendingTermsAccept";
