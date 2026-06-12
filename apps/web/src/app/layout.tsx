import type { Metadata } from 'next';
import { PostHogProvider } from '@/components/posthog-provider';
import './globals.css';

export const metadata: Metadata = {
	title: 'Gordian',
	description: 'Telegram-native CRM',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body className="bg-background text-foreground antialiased">
				<PostHogProvider>{children}</PostHogProvider>
			</body>
		</html>
	);
}
