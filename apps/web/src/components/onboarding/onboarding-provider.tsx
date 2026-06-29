'use client';

import {
	DEFAULT_TELEGRAM_SYNC_SCOPE,
	TELEGRAM_SYNC_SCOPES,
	type TelegramSyncScope,
} from '@repo/shared';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

export type TelegramCodeDeliveryMethod =
	| 'app'
	| 'sms'
	| 'call'
	| 'flash_call'
	| 'missed_call'
	| 'email'
	| 'fragment_sms'
	| 'firebase_sms'
	| 'email_setup'
	| 'unknown';

export interface TelegramCodeDeliveryState {
	method: TelegramCodeDeliveryMethod;
	codeLength: number;
	expiresInSeconds: number;
	sentAt: number;
	nextMethod?: TelegramCodeDeliveryMethod;
}

interface OnboardingState {
	phone: string;
	normalizedPhone: string;
	telegramCodeDelivery: TelegramCodeDeliveryState | null;
	consentAcknowledged: boolean;
	workspaceId: string | null;
	syncScope: TelegramSyncScope;
	enableAiProcessing: boolean;
}

interface OnboardingContextValue extends OnboardingState {
	hydrated: boolean;
	setPhone: (phone: string) => void;
	setNormalizedPhone: (phone: string) => void;
	setTelegramCodeDelivery: (delivery: TelegramCodeDeliveryState | null) => void;
	setConsentAcknowledged: (acknowledged: boolean) => void;
	setWorkspaceId: (id: string) => void;
	setSyncScope: (scope: TelegramSyncScope) => void;
	setEnableAiProcessing: (enabled: boolean) => void;
	clearOnboarding: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

const STORAGE_KEY = 'gordian-onboarding';

function loadState(): Partial<OnboardingState> {
	if (typeof window === 'undefined') return {};
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as Partial<OnboardingState>;
		if (parsed.syncScope && !TELEGRAM_SYNC_SCOPES.includes(parsed.syncScope as TelegramSyncScope)) {
			parsed.syncScope = DEFAULT_TELEGRAM_SYNC_SCOPE;
		}
		if (parsed.telegramCodeDelivery) {
			const delivery = parsed.telegramCodeDelivery;
			const codeLength = Number(delivery.codeLength);
			const expiresInSeconds = Number(delivery.expiresInSeconds);
			const sentAt = Number(delivery.sentAt);
			if (
				!Number.isInteger(codeLength) ||
				codeLength < 1 ||
				codeLength > 8 ||
				!Number.isFinite(expiresInSeconds) ||
				expiresInSeconds <= 0 ||
				!Number.isFinite(sentAt) ||
				sentAt <= 0
			) {
				parsed.telegramCodeDelivery = null;
			}
		}
		if (typeof parsed.enableAiProcessing !== 'boolean') {
			parsed.enableAiProcessing = false;
		}
		return parsed;
	} catch {
		return {};
	}
}

function saveState(state: OnboardingState) {
	if (typeof window === 'undefined') return;
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// sessionStorage full or unavailable
	}
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<OnboardingState>({
		phone: '',
		normalizedPhone: '',
		telegramCodeDelivery: null,
		consentAcknowledged: false,
		workspaceId: null,
		syncScope: DEFAULT_TELEGRAM_SYNC_SCOPE,
		enableAiProcessing: false,
	});
	const [hydrated, setHydrated] = useState(false);

	// Hydrate from sessionStorage on mount
	useEffect(() => {
		const saved = loadState();
		setState((prev) => ({ ...prev, ...saved }));
		setHydrated(true);
	}, []);

	// Persist to sessionStorage on change (after hydration)
	useEffect(() => {
		if (!hydrated) return;
		saveState(state);
	}, [state, hydrated]);

	const setPhone = useCallback((phone: string) => setState((prev) => ({ ...prev, phone })), []);
	const setNormalizedPhone = useCallback(
		(normalizedPhone: string) => setState((prev) => ({ ...prev, normalizedPhone })),
		[],
	);
	const setTelegramCodeDelivery = useCallback(
		(telegramCodeDelivery: TelegramCodeDeliveryState | null) =>
			setState((prev) => ({ ...prev, telegramCodeDelivery })),
		[],
	);
	const setConsentAcknowledged = useCallback(
		(consentAcknowledged: boolean) => setState((prev) => ({ ...prev, consentAcknowledged })),
		[],
	);
	const setWorkspaceId = useCallback(
		(workspaceId: string) => setState((prev) => ({ ...prev, workspaceId })),
		[],
	);
	const setSyncScope = useCallback(
		(syncScope: TelegramSyncScope) => setState((prev) => ({ ...prev, syncScope })),
		[],
	);
	const setEnableAiProcessing = useCallback(
		(enableAiProcessing: boolean) => setState((prev) => ({ ...prev, enableAiProcessing })),
		[],
	);
	const clearOnboarding = useCallback(() => {
		if (typeof window !== 'undefined') {
			sessionStorage.removeItem(STORAGE_KEY);
		}
		setState({
			phone: '',
			normalizedPhone: '',
			telegramCodeDelivery: null,
			consentAcknowledged: false,
			workspaceId: null,
			syncScope: DEFAULT_TELEGRAM_SYNC_SCOPE,
			enableAiProcessing: false,
		});
	}, []);

	return (
		<OnboardingContext.Provider
			value={{
				...state,
				hydrated,
				setPhone,
				setNormalizedPhone,
				setTelegramCodeDelivery,
				setConsentAcknowledged,
				setWorkspaceId,
				setSyncScope,
				setEnableAiProcessing,
				clearOnboarding,
			}}
		>
			{children}
		</OnboardingContext.Provider>
	);
}

export function useOnboarding() {
	const ctx = useContext(OnboardingContext);
	if (!ctx) {
		throw new Error('useOnboarding must be used within OnboardingProvider');
	}
	return ctx;
}
