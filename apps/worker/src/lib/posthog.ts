import { PostHog } from 'posthog-node';

let client: PostHog | null = null;

export function getPostHogWorker(): PostHog | null {
	const key = process.env.POSTHOG_API_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY;
	const host =
		process.env.POSTHOG_HOST || process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
	if (!key) return null;

	if (!client) {
		client = new PostHog(key, { host, flushAt: 20, flushInterval: 10000 });
	}
	return client;
}
