import posthog from 'posthog-js';

export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '';
export const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

export function initPostHog() {
	if (typeof window === 'undefined' || !POSTHOG_KEY) return;
	if (posthog.__loaded) return;

	posthog.init(POSTHOG_KEY, {
		api_host: POSTHOG_HOST,
		opt_out_capturing_by_default: true,
		capture_pageview: false,
		capture_pageleave: false,
		autocapture: false,
		disable_session_recording: true,
	});
}

export { posthog };
