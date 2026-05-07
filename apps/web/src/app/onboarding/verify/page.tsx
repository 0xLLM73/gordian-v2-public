'use client';

import { OnboardingCard } from '@/components/onboarding/onboarding-card';
import { useOnboarding } from '@/components/onboarding/onboarding-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

type Step = 'code' | '2fa' | 'success';
const TELEGRAM_LINKING_ENABLED = process.env.NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED === 'true';

export default function VerifyPage() {
	const router = useRouter();
	const { normalizedPhone, setWorkspaceId, hydrated } = useOnboarding();
	const [step, setStep] = useState<Step>('code');
	const digitKeys = ['d0', 'd1', 'd2', 'd3', 'd4'] as const;
	const [digits, setDigits] = useState(['', '', '', '', '']);
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

	// Redirect if no phone number (user navigated directly)
	// Wait for hydration so sessionStorage values are loaded first
	useEffect(() => {
		if (!hydrated) return;
		if (!normalizedPhone) {
			router.replace('/onboarding/connect');
		}
	}, [hydrated, normalizedPhone, router]);

	const handleVerify = useCallback(
		async (code: string, pwd?: string) => {
			setError(null);
			setPending(true);

			try {
				const res = await fetch('/api/auth/telegram/verify-code', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						phone: normalizedPhone,
						code,
						password: pwd || undefined,
					}),
				});

				const body = (await res.json().catch(() => ({}))) as {
					error?: string;
					message?: string;
					workspaceId?: string | null;
					requires2FA?: boolean;
				};

				// 2FA detection: Better Auth's ctx.json ignores custom status codes,
				// so check the body field instead of res.status === 202
				if (res.status === 202 || body.requires2FA) {
					setStep('2fa');
					setPending(false);
					return;
				}

				if (!res.ok || body.error) {
					throw new Error(body.error || body.message || 'Verification failed');
				}

				// Success — resolve workspace ID
				let resolvedWorkspaceId = body.workspaceId ?? null;

				// Fallback: fetch from status endpoint
				if (!resolvedWorkspaceId) {
					try {
						const statusRes = await fetch('/api/onboarding/status');
						if (statusRes.ok) {
							const status = await statusRes.json();
							resolvedWorkspaceId = status?.workspaceId ?? null;
						}
					} catch {
						// Status fetch failed — continue without workspaceId
					}
				}

				if (resolvedWorkspaceId) {
					setWorkspaceId(resolvedWorkspaceId);

					// Persist workspaceId to sessionStorage immediately so the sync page
					// can read it after the full page navigation below (React effects
					// may not flush before window.location.href fires).
					try {
						const raw = sessionStorage.getItem('gordian-onboarding');
						const saved = raw ? JSON.parse(raw) : {};
						saved.workspaceId = resolvedWorkspaceId;
						sessionStorage.setItem('gordian-onboarding', JSON.stringify(saved));
					} catch {
						// sessionStorage unavailable
					}
				}

				setStep('success');

				// Auto-advance after success animation
				setTimeout(() => {
					window.location.href = '/onboarding/sync';
				}, 1500);
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Something went wrong');
			} finally {
				setPending(false);
			}
		},
		[normalizedPhone, setWorkspaceId],
	);

	function handleDigitChange(index: number, value: string) {
		// Only accept digits
		const digit = value.replace(/\D/g, '').slice(-1);
		const next = [...digits];
		next[index] = digit;
		setDigits(next);

		if (digit && index < 4) {
			inputRefs.current[index + 1]?.focus();
		}

		// Auto-submit when all 5 digits are entered
		if (digit && index === 4 && next.every((d) => d !== '')) {
			handleVerify(next.join(''));
		}
	}

	function handleDigitKeyDown(index: number, e: React.KeyboardEvent) {
		if (e.key === 'Backspace' && !digits[index] && index > 0) {
			inputRefs.current[index - 1]?.focus();
		}
	}

	function handleDigitPaste(e: React.ClipboardEvent) {
		e.preventDefault();
		const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 5);
		if (!text) return;

		const next = [...digits];
		for (let i = 0; i < text.length; i++) {
			next[i] = text[i];
		}
		setDigits(next);

		if (text.length === 5) {
			handleVerify(next.join(''));
		} else {
			inputRefs.current[Math.min(text.length, 4)]?.focus();
		}
	}

	function handle2FASubmit(e: React.FormEvent) {
		e.preventDefault();
		handleVerify(digits.join(''), password);
	}

	if (!TELEGRAM_LINKING_ENABLED) {
		return (
			<OnboardingCard>
				<h1 className="text-2xl font-bold text-foreground">Telegram linking is disabled</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					This deployment is configured without Telegram account access.
				</p>
			</OnboardingCard>
		);
	}

	if (!hydrated || !normalizedPhone) return null;

	return (
		<OnboardingCard>
			{step === 'code' && (
				<div>
					<h1 className="text-2xl font-bold text-foreground">Enter verification code</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						We sent a code to your Telegram app for{' '}
						<span className="font-medium text-foreground">{normalizedPhone}</span>
					</p>

					{error && (
						<div className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
							{error}
						</div>
					)}

					<div className="mt-6 flex items-center justify-center gap-3" onPaste={handleDigitPaste}>
						{digits.map((digit, i) => (
							<input
								key={digitKeys[i]}
								ref={(el) => {
									inputRefs.current[i] = el;
									if (i === 0 && el) el.focus();
								}}
								type="text"
								inputMode="numeric"
								maxLength={1}
								value={digit}
								onChange={(e) => handleDigitChange(i, e.target.value)}
								onKeyDown={(e) => handleDigitKeyDown(i, e)}
								disabled={pending}
								className={cn(
									'h-14 w-12 rounded-lg border bg-card text-center text-2xl font-bold text-foreground outline-none transition-all',
									'focus:border-primary focus:ring-2 focus:ring-primary/20',
									'disabled:opacity-50',
									digit ? 'border-primary/50' : 'border-border',
								)}
							/>
						))}
					</div>

					{pending && (
						<p className="mt-4 text-center text-sm text-muted-foreground animate-pulse">
							Verifying...
						</p>
					)}
				</div>
			)}

			{step === '2fa' && (
				<div>
					<h1 className="text-2xl font-bold text-foreground">Two-factor authentication</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Your Telegram account has 2FA enabled. Enter your cloud password to continue.
					</p>

					{error && (
						<div className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
							{error}
						</div>
					)}

					<form onSubmit={handle2FASubmit} className="mt-6 space-y-4">
						<Input
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							placeholder="Cloud password"
							required
							autoFocus
						/>
						<Button type="submit" disabled={pending} className="w-full">
							{pending ? 'Verifying...' : 'Submit Password'}
						</Button>
					</form>
				</div>
			)}

			{step === 'success' && (
				<div className="flex flex-col items-center py-6">
					<div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
						<svg
							aria-hidden="true"
							className="h-8 w-8 text-success"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth={3}
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path
								d="M5 13l4 4L19 7"
								strokeDasharray="24"
								strokeDashoffset="24"
								style={{ animation: 'checkmark-draw 0.4s ease-out 0.1s forwards' }}
							/>
						</svg>
					</div>
					<h2 className="mt-4 text-xl font-bold text-foreground">Telegram connected!</h2>
					<p className="mt-2 text-sm text-muted-foreground">Setting up your workspace...</p>
				</div>
			)}
		</OnboardingCard>
	);
}
