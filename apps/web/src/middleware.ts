import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
	// CSRF: Validate Origin header on state-changing requests
	if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
		const origin = request.headers.get('origin');
		const host = request.headers.get('host');

		// Allow requests with no origin (same-origin form submissions, non-browser clients)
		// But if origin IS present, it must match the host
		if (origin) {
			const originHost = new URL(origin).host;
			if (originHost !== host) {
				return new NextResponse('CSRF validation failed', { status: 403 });
			}
		}
	}

	return NextResponse.next();
}

export const config = {
	// Apply to all routes except static files and API auth (Better Auth handles its own CSRF)
	matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth).*)'],
};
