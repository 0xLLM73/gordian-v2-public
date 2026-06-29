import { getInviteByToken } from '@repo/db';
import { NextResponse } from 'next/server';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
	const { token } = await params;

	if (token?.length !== 36) {
		return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
	}

	const invite = await getInviteByToken(token);

	if (!invite) {
		return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
	}

	if (invite.acceptedAt) {
		return NextResponse.json({ error: 'Invite already used' }, { status: 410 });
	}

	if (new Date() > invite.expiresAt) {
		return NextResponse.json({ error: 'Invite expired' }, { status: 410 });
	}

	return NextResponse.json({
		workspaceName: invite.workspaceName,
		email: invite.email,
		role: invite.role,
	});
}
