'use client';

import { inviteSignupAction } from '@/app/actions/invites';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function InviteSignupForm({ token, email }: { token: string; email: string | null }) {
	const router = useRouter();
	const [name, setName] = useState('');
	const [emailValue, setEmailValue] = useState(email ?? '');
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setError(null);
		setPending(true);

		try {
			const signupResult = await inviteSignupAction({
				token,
				name,
				email: emailValue,
				password,
			});

			if (signupResult?.serverError || !signupResult?.data) {
				setError(signupResult?.serverError || 'Failed to create account');
				setPending(false);
				return;
			}

			const signInResult = await authClient.signIn.email({ email: emailValue, password });
			if (signInResult.error) {
				setError(signInResult.error.message || 'Account created. Please log in.');
				setPending(false);
				return;
			}

			router.push('/onboarding/connect');
			router.refresh();
		} catch {
			setError('Something went wrong. Please try again.');
			setPending(false);
		}
	}

	return (
		<>
			{error ? (
				<div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
			) : null}

			<form onSubmit={handleSubmit} className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="name">Name</Label>
					<Input
						id="name"
						name="name"
						type="text"
						required
						value={name}
						onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="email">Email</Label>
					<Input
						id="email"
						name="email"
						type="email"
						required
						value={emailValue}
						readOnly={!!email}
						onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmailValue(e.target.value)}
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="password">Password</Label>
					<Input
						id="password"
						name="password"
						type="password"
						required
						minLength={8}
						value={password}
						onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
					/>
				</div>

				<Button type="submit" disabled={pending} className="w-full">
					{pending ? 'Creating account...' : 'Create account'}
				</Button>
			</form>
		</>
	);
}
