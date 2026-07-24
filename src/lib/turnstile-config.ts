export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

export const TURNSTILE_ACTIONS = {
  featureRequestSubmit: "feature_request_submit",
  featureRequestVote: "feature_request_vote",
} as const;

export type TurnstileAction =
  (typeof TURNSTILE_ACTIONS)[keyof typeof TURNSTILE_ACTIONS];
