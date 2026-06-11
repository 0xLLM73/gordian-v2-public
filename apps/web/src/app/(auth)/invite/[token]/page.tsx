import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { getInviteByToken } from '@repo/db';
import Link from 'next/link';
import { InviteSignupForm } from './signup-form';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
	const { token } = await params;
	const invite = await getInviteByToken(token);

	if (!invite) {
		return (
			<Card className="shadow-stripe-lg">
				<CardHeader>
					<CardTitle className="text-2xl">Invalid Invite</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						This invite link is invalid or has already been used.
					</p>
				</CardContent>
				<CardFooter className="justify-center">
					<Link href="/login" className="text-sm font-medium text-primary hover:text-primary/80">
						Go to sign in
					</Link>
				</CardFooter>
			</Card>
		);
	}

	if (invite.acceptedAt) {
		return (
			<Card className="shadow-stripe-lg">
				<CardHeader>
					<CardTitle className="text-2xl">Invite Already Used</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">This invite has already been accepted.</p>
				</CardContent>
				<CardFooter className="justify-center">
					<Link href="/login" className="text-sm font-medium text-primary hover:text-primary/80">
						Go to sign in
					</Link>
				</CardFooter>
			</Card>
		);
	}

	if (new Date() > invite.expiresAt) {
		return (
			<Card className="shadow-stripe-lg">
				<CardHeader>
					<CardTitle className="text-2xl">Invite Expired</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						This invite link has expired. Ask the workspace owner for a new one.
					</p>
				</CardContent>
				<CardFooter className="justify-center">
					<Link href="/login" className="text-sm font-medium text-primary hover:text-primary/80">
						Go to sign in
					</Link>
				</CardFooter>
			</Card>
		);
	}

	return (
		<Card className="shadow-stripe-lg">
			<CardHeader>
				<CardTitle className="text-2xl">You&apos;re Invited to Gordian</CardTitle>
				<p className="text-sm text-muted-foreground">Create an account to join this workspace.</p>
			</CardHeader>
			<CardContent>
				<InviteSignupForm token={token} email={invite.email} />
			</CardContent>
			<CardFooter className="justify-center">
				<p className="text-sm text-muted-foreground">
					Already have an account?{' '}
					<Link href="/login" className="font-medium text-primary hover:text-primary/80">
						Sign in
					</Link>
				</p>
			</CardFooter>
		</Card>
	);
}
