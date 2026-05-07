import { NetworkGraph } from '@/components/network/network-graph';
import { requireSession } from '@/lib/workspace';

export default async function NetworkPage() {
	await requireSession();

	return (
		<div>
			<h1 className="mb-6 text-2xl font-bold text-foreground">Network</h1>
			<NetworkGraph />
		</div>
	);
}
