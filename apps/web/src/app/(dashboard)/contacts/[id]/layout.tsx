export default function ContactDetailLayout({
	children,
	chat,
}: {
	children: React.ReactNode;
	chat: React.ReactNode;
}) {
	return (
		<div className="flex h-full gap-6">
			<div className="flex-1">{children}</div>
			<div className="hidden w-96 shrink-0 lg:block">{chat}</div>
		</div>
	);
}
