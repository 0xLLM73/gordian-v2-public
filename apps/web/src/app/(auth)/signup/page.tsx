import Link from 'next/link';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

export default function SignupPage() {
	return (
		<Card className="shadow-stripe-lg">
			<CardHeader>
				<CardTitle className="text-2xl">Sign up is currently closed</CardTitle>
			</CardHeader>
			<CardContent>
				<p className="text-sm text-muted-foreground">
					New accounts require an invite link from a workspace owner. If you&apos;ve received one,
					please use that link to sign up.
				</p>
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
