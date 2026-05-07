import Link from 'next/link';

export default function NotFound() {
	return (
		<div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
			<h1 className="text-6xl font-bold text-gray-300">404</h1>
			<p className="mt-4 text-lg font-medium text-foreground">Page not found</p>
			<p className="mt-2 text-sm text-muted-foreground">
				The page you're looking for doesn't exist or has been moved.
			</p>
			<Link
				href="/"
				className="mt-6 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
			>
				Back to Dashboard
			</Link>
		</div>
	);
}
