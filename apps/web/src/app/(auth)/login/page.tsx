'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const DEMO_LOGIN_ENABLED = process.env.NEXT_PUBLIC_DEMO_LOGIN_ENABLED === 'true';
const DEMO_EMAIL = process.env.NEXT_PUBLIC_DEMO_EMAIL || 'alice@gordian.dev';
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD || 'gordian-demo';

export default function LoginPage() {
	const router = useRouter();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setError(null);
		setPending(true);

		const result = await authClient.signIn.email({
			email,
			password,
		});

		if (result.error) {
			setError(result.error.message || 'Sign in failed');
			setPending(false);
			return;
		}

		router.push('/');
		router.refresh();
	}

	return (
		<Card className="shadow-stripe-lg">
			<CardHeader>
				<CardTitle className="text-2xl">Sign in to Gordian</CardTitle>
			</CardHeader>
			<CardContent>
				{error && <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

				{DEMO_LOGIN_ENABLED ? (
					<div className="mb-4 rounded-md border border-border bg-muted p-3">
						<div className="flex items-center justify-between gap-3">
							<div>
								<p className="text-sm font-medium text-foreground">Local demo account</p>
								<p className="mt-0.5 text-xs text-muted-foreground">{DEMO_EMAIL}</p>
							</div>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onClick={() => {
									setEmail(DEMO_EMAIL);
									setPassword(DEMO_PASSWORD);
									setError(null);
								}}
							>
								Use demo login
							</Button>
						</div>
					</div>
				) : null}

				<form id="login-form" onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="email">Email</Label>
						<Input
							id="email"
							name="email"
							type="email"
							required
							value={email}
							onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="password">Password</Label>
						<Input
							id="password"
							name="password"
							type="password"
							required
							value={password}
							onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
						/>
					</div>

					<Button type="submit" disabled={pending} className="w-full">
						{pending ? 'Signing in...' : 'Sign in'}
					</Button>
				</form>
			</CardContent>
			<CardFooter className="justify-center">
				<p className="text-sm text-muted-foreground">
					Don&apos;t have an account?{' '}
					<Link href="/signup" className="font-medium text-primary hover:text-primary/80">
						Sign up
					</Link>
				</p>
			</CardFooter>
		</Card>
	);
}
