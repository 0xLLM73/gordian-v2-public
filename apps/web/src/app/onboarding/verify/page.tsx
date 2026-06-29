'use client';

import { TELEGRAM_CONSENT_VERSION } from '@repo/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { OnboardingCard } from '@/components/onboarding/onboarding-card';
import {
	type TelegramCodeDeliveryMethod,
	type TelegramCodeDeliveryState,
	useOnboarding,
} from '@/components/onboarding/onboarding-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Step = 'code' | '2fa' | 'success';
const TELEGRAM_LINKING_ENABLED = process.env.NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED === 'true';
const DEFAULT_CODE_LENGTH = 5;
const TELEGRAM_CODE_DELIVERY_METHODS = new Set<TelegramCodeDeliveryMethod>([
	'app',
	'sms',
	'call',
	'flash_call',
	'missed_call',
	'email',
	'fragment_sms',
	'firebase_sms',
	'email_setup',
	'unknown',
]);

function isAlreadyLinkedError(error: string | null) {
	return Boolean(error?.toLowerCase().includes('already linked'));
}

function normalizeCodeLength(value: unknown): number {
	const numeric = Number(value);
	return Number.isInteger(numeric) && numeric >= 1 && numeric <= 8 ? numeric : DEFAULT_CODE_LENGTH;
}

function normalizeDeliveryMethod(value: unknown): TelegramCodeDeliveryMethod {
	return typeof value === 'string' &&
		TELEGRAM_CODE_DELIVERY_METHODS.has(value as TelegramCodeDeliveryMethod)
		? (value as TelegramCodeDeliveryMethod)
		: 'unknown';
}

function normalizeCodeDelivery(raw: unknown): TelegramCodeDeliveryState {
	const delivery = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const expiresInSeconds = Number(delivery.expiresInSeconds);
	const nextMethod = normalizeDeliveryMethod(delivery.nextMethod);

	return {
		method: normalizeDeliveryMethod(delivery.method),
		codeLength: normalizeCodeLength(delivery.codeLength),
		expiresInSeconds:
			Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
				? Math.min(Math.trunc(expiresInSeconds), 300)
				: 300,
		sentAt: Date.now(),
		...(nextMethod !== 'unknown' ? { nextMethod } : {}),
	};
}

function deliveryLabel(method: TelegramCodeDeliveryMethod): string {
	switch (method) {
		case 'app':
			return 'Telegram app';
		case 'sms':
		case 'fragment_sms':
		case 'firebase_sms':
			return 'SMS';
		case 'call':
			return 'phone call';
		case 'flash_call':
			return 'flash call';
		case 'missed_call':
			return 'missed call';
		case 'email':
			return 'email';
		case 'email_setup':
			return 'email setup';
		default:
			return 'Telegram';
	}
}

function deliveryDetail(delivery: TelegramCodeDeliveryState | null): string {
	if (!delivery) {
		return 'Telegram accepted the login request. If no code appears, request a new one below.';
	}
	const codeDescription = `${delivery.codeLength}-digit code`;
	switch (delivery.method) {
		case 'app':
			return `Telegram sent a ${codeDescription} inside your Telegram app. Check any device where this account is already signed in.`;
		case 'sms':
		case 'fragment_sms':
		case 'firebase_sms':
			return `Telegram sent a ${codeDescription} by SMS. Delivery can lag if Telegram recently sent another login code.`;
		case 'call':
			return `Telegram will provide a ${codeDescription} by phone call.`;
		case 'flash_call':
		case 'missed_call':
			return 'Telegram is using a call-based login check. Follow the instructions from Telegram on your phone.';
		case 'email':
			return `Telegram sent a ${codeDescription} by email for this login.`;
		case 'email_setup':
			return 'Telegram requires email setup before this login can continue.';
		default:
			return `Telegram accepted the request for a ${codeDescription}. If no code appears, request a new one below.`;
	}
}

function formatSeconds(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export default function VerifyPage() {
	const router = useRouter();
	const {
		normalizedPhone,
		telegramCodeDelivery,
		setTelegramCodeDelivery,
		setWorkspaceId,
		hydrated,
	} = useOnboarding();
	const [step, setStep] = useState<Step>('code');
	const codeLength = telegramCodeDelivery?.codeLength ?? DEFAULT_CODE_LENGTH;
	const digitKeys = Array.from({ length: codeLength }, (_, i) => `d${i}`);
	const [digits, setDigits] = useState(() => Array.from({ length: DEFAULT_CODE_LENGTH }, () => ''));
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [resendPending, setResendPending] = useState(false);
	const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
	const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

	// Redirect if no phone number (user navigated directly)
	// Wait for hydration so sessionStorage values are loaded first
	useEffect(() => {
		if (!hydrated) return;
		if (!normalizedPhone) {
			router.replace('/onboarding/connect');
		}
	}, [hydrated, normalizedPhone, router]);

	useEffect(() => {
		setDigits((prev) => Array.from({ length: codeLength }, (_, i) => prev[i] ?? ''));
		inputRefs.current = inputRefs.current.slice(0, codeLength);
	}, [codeLength]);

	useEffect(() => {
		if (!telegramCodeDelivery) {
			setSecondsRemaining(null);
			return;
		}

		const delivery = telegramCodeDelivery;
		function updateRemaining() {
			const expiresAt = delivery.sentAt + delivery.expiresInSeconds * 1000;
			setSecondsRemaining(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
		}

		updateRemaining();
		const interval = window.setInterval(updateRemaining, 1000);
		return () => window.clearInterval(interval);
	}, [telegramCodeDelivery]);

	const handleResendCode = useCallback(async () => {
		setError(null);
		setResendPending(true);

		try {
			const res = await fetch('/api/auth/telegram/send-code', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					phone: normalizedPhone,
					consentVersion: TELEGRAM_CONSENT_VERSION,
				}),
			});
			const body = (await res.json().catch(() => ({}))) as {
				error?: string;
				message?: string;
				delivery?: unknown;
			};

			if (!res.ok || body.error) {
				throw new Error(body.error || body.message || 'Failed to send a new code');
			}

			const nextDelivery = normalizeCodeDelivery(body.delivery);
			setTelegramCodeDelivery(nextDelivery);
			setDigits(Array.from({ length: nextDelivery.codeLength }, () => ''));
			setPassword('');
			setStep('code');
			window.setTimeout(() => inputRefs.current[0]?.focus(), 0);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to send a new code');
		} finally {
			setResendPending(false);
		}
	}, [normalizedPhone, setTelegramCodeDelivery]);

	const handleVerify = useCallback(
		async (code: string, pwd?: string) => {
			if (secondsRemaining === 0 && !pwd) {
				setError('Verification code expired. Send a new code.');
				return;
			}

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
					authExpired?: boolean;
					codeInvalid?: boolean;
				};

				// 2FA detection: Better Auth's ctx.json ignores custom status codes,
				// so check the body field instead of res.status === 202
				if (res.status === 202 || body.requires2FA) {
					setStep('2fa');
					setPending(false);
					return;
				}

				if (body.authExpired || body.codeInvalid) {
					setError(body.error || body.message || 'Verification failed');
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
					window.location.href = '/onboarding/permissions';
				}, 1500);
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Something went wrong');
			} finally {
				setPending(false);
			}
		},
		[normalizedPhone, secondsRemaining, setWorkspaceId],
	);

	function handleDigitChange(index: number, value: string) {
		// Only accept digits
		const digit = value.replace(/\D/g, '').slice(-1);
		const next = [...digits];
		next[index] = digit;
		setDigits(next);

		if (digit && index < codeLength - 1) {
			inputRefs.current[index + 1]?.focus();
		}

		// Auto-submit when all expected digits are entered.
		if (digit && index === codeLength - 1 && next.every((d) => d !== '')) {
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
		const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, codeLength);
		if (!text) return;

		const next = [...digits];
		for (let i = 0; i < text.length; i++) {
			next[i] = text[i];
		}
		setDigits(next);

		if (text.length === codeLength) {
			handleVerify(next.join(''));
		} else {
			inputRefs.current[Math.min(text.length, codeLength - 1)]?.focus();
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
	const alreadyLinked = isAlreadyLinkedError(error);
	const codeExpired = secondsRemaining === 0;
	const deliveryName = deliveryLabel(telegramCodeDelivery?.method ?? 'unknown');

	return (
		<OnboardingCard>
			{step === 'code' && (
				<div>
					<h1 className="text-2xl font-bold text-foreground">Enter verification code</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Telegram accepted a login code request for{' '}
						<span className="font-medium text-foreground">{normalizedPhone}</span>
					</p>
					<div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
						<p className="text-sm font-medium text-foreground">Delivery method: {deliveryName}</p>
						<p className="mt-1 text-sm text-muted-foreground">
							{deliveryDetail(telegramCodeDelivery)}
						</p>
						{secondsRemaining !== null && (
							<p
								className={cn(
									'mt-2 text-xs font-medium',
									codeExpired ? 'text-destructive' : 'text-muted-foreground',
								)}
							>
								{codeExpired
									? 'This login code has expired.'
									: `Code expires in ${formatSeconds(secondsRemaining)}.`}
							</p>
						)}
					</div>
					<div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
						<p className="text-sm font-medium text-foreground">What this code does</p>
						<p className="mt-1 text-sm text-muted-foreground">
							Telegram creates an MTProto login first. Gordian stores that login only after it
							confirms this Telegram account is allowed to attach to the current Gordian user.
						</p>
					</div>

					{error && (
						<div className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
							{alreadyLinked ? (
								<div className="space-y-2">
									<p className="font-medium">Telegram login was not attached</p>
									<p>
										Telegram accepted the verification code, but Gordian refused to attach this
										Telegram account because it is already linked to another Gordian user.
									</p>
									<p>
										The temporary local session key was discarded. Because Telegram may still show a
										new login notification, revoke the new session from Telegram Settings &gt;
										Devices if you did not intend to create it.
									</p>
									<p>
										Sign in as the Gordian user that already owns this Telegram account, or
										disconnect that user before linking here.
									</p>
									<Button asChild variant="outline" size="sm" className="mt-2">
										<Link href="/onboarding/connect">Back to phone number</Link>
									</Button>
								</div>
							) : (
								error
							)}
						</div>
					)}

					<div
						className="mt-6 flex flex-wrap items-center justify-center gap-3"
						onPaste={handleDigitPaste}
					>
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
								disabled={pending || resendPending || codeExpired}
								className={cn(
									'h-14 w-12 rounded-lg border bg-card text-center text-2xl font-bold text-foreground outline-none transition-all',
									'focus:border-primary focus:ring-2 focus:ring-primary/20',
									'disabled:opacity-50',
									digit ? 'border-primary/50' : 'border-border',
								)}
							/>
						))}
					</div>

					<div className="mt-6 flex flex-wrap items-center justify-center gap-3">
						<Button
							type="button"
							variant="outline"
							onClick={handleResendCode}
							disabled={pending || resendPending}
						>
							{resendPending ? 'Sending...' : codeExpired ? 'Send new code' : 'Resend code'}
						</Button>
						<Button asChild type="button" variant="ghost">
							<Link href="/onboarding/connect">Use a different phone</Link>
						</Button>
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
