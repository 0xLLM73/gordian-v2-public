'use client';

import { OnboardingCard } from '@/components/onboarding/onboarding-card';
import { useOnboarding } from '@/components/onboarding/onboarding-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { TELEGRAM_CONSENT_VERSION } from '@repo/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const CONSENT_ITEMS = [
	{
		title: 'Read-only Telegram access',
		description:
			'Gordian connects as an unofficial Telegram client. This build can read only the import scope you choose next and cannot send messages.',
	},
	{
		title: 'Session custody',
		description:
			'Telegram creates a reusable local session credential. Gordian encrypts it at rest, and you can disconnect locally from Settings.',
	},
	{
		title: 'Revocation and deletion',
		description:
			'After disconnecting, open Telegram Settings > Devices and terminate the Gordian session to revoke it from Telegram.',
	},
	{
		title: 'AI processing',
		description:
			'AI analysis is off by default for imports. If you enable it, eligible imported messages may be summarized, embedded, or classified by configured AI providers.',
	},
];
const TELEGRAM_LINKING_ENABLED = process.env.NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED === 'true';

export default function ConnectPage() {
	const router = useRouter();
	const { phone, setPhone, setNormalizedPhone, consentAcknowledged, setConsentAcknowledged } =
		useOnboarding();
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [consentOpen, setConsentOpen] = useState(false);

	if (!TELEGRAM_LINKING_ENABLED) {
		return (
			<OnboardingCard>
				<h1 className="text-2xl font-bold text-foreground">Telegram linking is disabled</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					This build does not request Telegram account access. Enable it only with a dedicated test
					Telegram app and throwaway account.
				</p>
				<div className="mt-6 rounded-lg border border-border bg-muted/40 p-4">
					<p className="text-sm font-medium text-foreground">Use the local demo workspace</p>
					<p className="mt-1 text-sm text-muted-foreground">
						Run <code className="rounded bg-background px-1 py-0.5">pnpm demo:setup</code>, then
						sign in as <code className="rounded bg-background px-1 py-0.5">alice@gordian.dev</code>.
					</p>
					<Button asChild className="mt-4 w-full">
						<Link href="/login">Go to sign in</Link>
					</Button>
				</div>
			</OnboardingCard>
		);
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!consentAcknowledged) {
			setError('Please acknowledge the data usage terms below.');
			setConsentOpen(true);
			return;
		}

		setError(null);
		setPending(true);

		try {
			// Normalize phone: strip all non-digits, ensure leading +
			const digits = phone.replace(/[^\d]/g, '');
			const np = `+${digits}`;
			setNormalizedPhone(np);

			const res = await fetch('/api/auth/telegram/send-code', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ phone: np, consentVersion: TELEGRAM_CONSENT_VERSION }),
			});

			const data = (await res.json()) as { success?: boolean; error?: string; message?: string };

			if (!res.ok || data.error) {
				throw new Error(data.error || data.message || 'Failed to send code');
			}

			router.push('/onboarding/verify');
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Something went wrong');
		} finally {
			setPending(false);
		}
	}

	return (
		<OnboardingCard>
			<div className="mb-6">
				<h1 className="text-2xl font-bold text-foreground">Let's map your network</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					Connect Telegram in read-only mode, then choose exactly what Gordian may import.
				</p>
			</div>

			<div className="mb-5 rounded-lg border border-border bg-muted/40 p-4">
				<p className="text-sm font-medium text-foreground">Before connecting</p>
				<p className="mt-1 text-sm text-muted-foreground">
					Create a dedicated Telegram API app at{' '}
					<a
						href="https://my.telegram.org/apps"
						target="_blank"
						rel="noreferrer"
						className="font-medium text-primary hover:text-primary/80"
					>
						my.telegram.org/apps
					</a>
					, then run <code className="rounded bg-background px-1 py-0.5">pnpm telegram:setup</code>{' '}
					to save your <code className="rounded bg-background px-1 py-0.5">api_id</code> and{' '}
					<code className="rounded bg-background px-1 py-0.5">api_hash</code> locally.
				</p>
			</div>

			{error && (
				<div className="mb-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
					{error}
				</div>
			)}

			<form onSubmit={handleSubmit} className="space-y-4">
				<div>
					<label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-foreground">
						Phone Number
					</label>
					<Input
						id="phone"
						type="tel"
						value={phone}
						onChange={(e) => setPhone(e.target.value)}
						placeholder="+1 234 567 8900"
						required
						autoFocus
					/>
					<p className="mt-1.5 text-xs text-muted-foreground">
						The phone number linked to your Telegram account.
					</p>
				</div>

				<Button type="submit" disabled={pending} className="w-full">
					{pending ? 'Sending code...' : 'Send Verification Code'}
				</Button>
			</form>

			{/* Inline consent */}
			<div className="mt-6 border-t border-border pt-4">
				<button
					type="button"
					onClick={() => setConsentOpen(!consentOpen)}
					className="flex w-full items-center justify-between text-sm text-muted-foreground hover:text-foreground transition-colors"
				>
					<span className="font-medium">How Gordian uses your data</span>
					<svg
						aria-hidden="true"
						className={cn('h-4 w-4 transition-transform duration-200', consentOpen && 'rotate-180')}
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth={2}
					>
						<path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
					</svg>
				</button>

				{consentOpen && (
					<div className="mt-3 space-y-3 animate-[fade-slide-up_0.2s_ease-out]">
						{CONSENT_ITEMS.map((item) => (
							<div key={item.title} className="rounded-lg bg-muted/50 p-3">
								<p className="text-sm font-medium text-foreground">{item.title}</p>
								<p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
							</div>
						))}
					</div>
				)}

				<label className="mt-3 flex cursor-pointer items-start gap-2.5">
					<input
						type="checkbox"
						checked={consentAcknowledged}
						onChange={(e) => setConsentAcknowledged(e.target.checked)}
						className="mt-0.5 h-4 w-4 rounded border-border text-primary accent-primary"
					/>
					<span className="text-xs text-muted-foreground">
						I understand Gordian will create a local Telegram session, and I know I must revoke it
						from Telegram Settings &gt; Devices if I no longer trust this device.
					</span>
				</label>
			</div>
		</OnboardingCard>
	);
}
