import { CalibrationWizard } from '@/app/(dashboard)/calibration/calibration-wizard';
import { getUserWorkspaceId, getWorkspaceEnvelope, requireSession } from '@/lib/workspace';
import { getCalibration } from '@repo/db';

export const metadata = { title: 'Calibrate Gordian' };

export default async function CalibrationPage() {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);

	let initialData = null;
	if (workspaceId) {
		const envelope = await getWorkspaceEnvelope(workspaceId);
		if (envelope) {
			initialData = await getCalibration(session.user.id, workspaceId, envelope);
		}
	}

	return (
		<div>
			<div className="mb-8">
				<h1 className="text-2xl font-bold text-foreground">Calibrate Gordian</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Personalise AI summaries, message drafts, and briefs to your communication style and
					investment approach. Takes about 2 minutes.
				</p>
			</div>

			<CalibrationWizard initialData={initialData} />
		</div>
	);
}
