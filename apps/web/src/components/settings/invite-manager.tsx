'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { createInviteAction, listInvitesAction } from '@/app/actions/invites';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';

interface Invite {
	id: string;
	email: string | null;
	role: string;
	token: string;
	expiresAt: Date;
	acceptedAt: Date | null;
	createdAt: Date;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export function InviteManager() {
	const [invites, setInvites] = useState<Invite[]>([]);
	const [showForm, setShowForm] = useState(false);
	const [email, setEmail] = useState('');
	const [role, setRole] = useState<'member' | 'admin'>('member');
	const [isPending, startTransition] = useTransition();

	useEffect(() => {
		loadInvites();
	}, []);

	async function loadInvites() {
		const result = await listInvitesAction({});
		if (result?.data) {
			setInvites(result.data as Invite[]);
		}
	}

	function handleCreate() {
		startTransition(async () => {
			const result = await createInviteAction({
				email: email || undefined,
				role,
			});

			if (result?.serverError) {
				toast.error(result.serverError);
				return;
			}

			if (result?.data?.url) {
				await navigator.clipboard.writeText(result.data.url);
				toast.success('Invite created and link copied to clipboard');
			}

			setEmail('');
			setRole('member');
			setShowForm(false);
			await loadInvites();
		});
	}

	function copyLink(token: string) {
		const url = `${APP_URL}/invite/${token}`;
		navigator.clipboard.writeText(url);
		toast.success('Invite link copied');
	}

	function getStatus(invite: Invite): {
		label: string;
		variant: 'default' | 'secondary' | 'destructive';
	} {
		if (invite.acceptedAt) return { label: 'Accepted', variant: 'default' };
		if (new Date(invite.expiresAt) < new Date())
			return { label: 'Expired', variant: 'destructive' };
		return { label: 'Pending', variant: 'secondary' };
	}

	return (
		<div>
			{showForm ? (
				<div className="mb-4 space-y-3 rounded-md border border-border p-4">
					<div className="space-y-2">
						<Label htmlFor="invite-email">Email (optional)</Label>
						<Input
							id="invite-email"
							type="email"
							placeholder="name@example.com"
							value={email}
							onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
						/>
						<p className="text-xs text-muted-foreground">
							Restricts signup to this email. Leave blank for an open invite link.
						</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="invite-role">Role</Label>
						<Select value={role} onValueChange={(v: string) => setRole(v as 'member' | 'admin')}>
							<SelectTrigger id="invite-role">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="member">Member</SelectItem>
								<SelectItem value="admin">Admin</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="flex gap-2">
						<Button onClick={handleCreate} disabled={isPending} size="sm">
							{isPending ? 'Creating...' : 'Create & copy link'}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setShowForm(false)}
							disabled={isPending}
						>
							Cancel
						</Button>
					</div>
				</div>
			) : (
				<Button onClick={() => setShowForm(true)} size="sm" className="mb-4">
					Create Invite
				</Button>
			)}

			{invites.length === 0 ? (
				<p className="text-sm text-muted-foreground">No invites yet.</p>
			) : (
				<div className="divide-y divide-border">
					{invites.map((invite) => {
						const status = getStatus(invite);
						return (
							<div key={invite.id} className="flex items-center justify-between py-3">
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<p className="text-sm font-medium text-foreground">
											{invite.email || 'Open invite'}
										</p>
										<Badge variant={status.variant}>{status.label}</Badge>
										<span className="text-xs text-muted-foreground">{invite.role}</span>
									</div>
									<p className="text-xs text-muted-foreground">
										Created {new Date(invite.createdAt).toLocaleDateString()}
										{!invite.acceptedAt && new Date(invite.expiresAt) > new Date()
											? ` \u00b7 Expires ${new Date(invite.expiresAt).toLocaleDateString()}`
											: null}
									</p>
								</div>
								{!invite.acceptedAt && new Date(invite.expiresAt) > new Date() ? (
									<Button
										variant="outline"
										size="sm"
										onClick={() => copyLink(invite.token)}
										className="ml-4"
									>
										Copy link
									</Button>
								) : null}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
