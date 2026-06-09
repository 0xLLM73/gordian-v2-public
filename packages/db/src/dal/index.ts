export {
	getContact,
	getContactsByIds,
	searchContactByName,
	searchContactByPhone,
	searchContactByEmail,
	searchContactByUsername,
	createContact,
	updateContact,
	listContacts,
	listContactMaskingAliases,
	canAccessContact,
	canManageContact,
	getAccessibleContact,
	getAccessibleContacts,
	getAccessibleContactTelegramId,
	getUserTelegramAccountIds,
	shareContact,
	unshareContact,
	getContactShares,
	updateContactRecency,
	getStaleContacts,
	dismissGhostingAlert,
} from './contacts';
export type { ContactMaskingAlias, CreateContactInput, UpdateContactInput } from './contacts';

export {
	getContactTag,
	upsertContactTag,
	listContactsByTag,
	deleteContactTag,
} from './contact-tags';
export type { UpsertContactTagInput, ListContactsByTagFilters } from './contact-tags';

export {
	createMemory,
	getMemoriesByContact,
	getUnembeddedMemories,
	backfillMemoryMessageMetadata,
	mergeMemoryMessageBackfillMetadata,
	hybridSearch,
	textSearch,
	updateMemoryEmbedding,
} from './memories';
export type {
	CreateMemoryInput,
	HybridSearchResult,
	MemoryMessageBackfillCandidate,
	MemoryMessageBackfillContactSummary,
	MemoryMessageBackfillOptions,
	MemoryMessageBackfillReport,
	MemoryMessageBackfillSkipReason,
	MemoryMessageBackfillWorkspaceSummary,
	UnembeddedMemory,
} from './memories';

export {
	createCommitment,
	getCommitmentsByContact,
	updateCommitmentStatus,
	getActiveCommitments,
	getCommitmentsByWorkspace,
	getCommitmentsForFulfillmentCheck,
	markCommitmentFulfilled,
	updateLastCheckedAt,
	getCommitmentForFeedback,
	getCommitmentBanditTrace,
	getCommitmentsForFirstLook,
	snoozeCommitment,
} from './commitments';
export type { CreateCommitmentInput } from './commitments';

export {
	createDeal,
	listDeals,
	getDeal,
	updateDeal,
	getDealsByContact,
	getDealStageCounts,
	getStageVelocityStats,
	computeDealConfidence,
	deleteDeal,
	DEAL_SORT_OPTIONS,
} from './deals';
export type {
	CreateDealInput,
	DealConfidenceBadge,
	DealConfidenceResult,
	DealSortOption,
	StageVelocityStats,
	UpdateDealInput,
} from './deals';

export {
	createDecision,
	createEdge,
	graphragSearch,
	getDecisionsByWorkspace,
	findRecentDecision,
	findSimilarDecisions,
	findDecisionByEntityId,
	updateEdgeWeight,
	findEdgesByTargetDecision,
	decayStaleEdges,
} from './decisions';
export type { CreateDecisionInput, CreateEdgeInput, GraphSearchResult } from './decisions';

export {
	createGoldenExample,
	findSimilarExamples,
	getGoldenLibrary,
	recordBanditTrial,
	finalizeBanditReward,
	getBanditStats,
	getBanditStatsBucketed,
	hashInputContext,
	listPendingExamples,
	promoteToGold,
	rejectExample,
	isContaminated,
	getReviewQueueStats,
} from './golden-dataset';
export type {
	CreateGoldenExampleInput,
	RecordBanditTrialInput,
	BanditStats,
	BanditBucketedStats,
} from './golden-dataset';

export {
	upsertChat,
	updateChatLastSync,
	getChatByTelegramId,
	getChatsByIds,
	listChats,
	upsertMessages,
	linkMessagesToContact,
	linkMessagesToContactsByTelegramIds,
	getMessageContactCoverageReport,
	getMessageNullContactReasonReport,
	repairMessagesToSenderContacts,
	repairPrivateMessagesToPeerContacts,
	updateMessageSenderMetadataByTelegramIds,
	listMessageIdsByTelegramIds,
	getMessagesByChat,
	getMessagesByTelegramIds,
	getMessagesByContact,
	getMessagesByIds,
	getNullContactSenderMetadataGap,
	getRecentMessages,
	getMessageCount,
	getMessageTimeRangeStats,
	getLastMessageDate,
	getLatestMessageTimestamp,
	getMessagesByTimeRange,
} from './messages';
export type {
	MessageContactCoverageByChatType,
	MessageContactCoverageReport,
	MessageNullContactReasonReport,
	MessageNullContactReasonRow,
	MessageIdentity,
	MessageSenderMetadataLink,
	PrivatePeerContactRepairResult,
	SenderMetadataContactRepairResult,
	TelegramSenderType,
	UpsertChatInput,
	UpsertMessageInput,
} from './messages';

export {
	TELEGRAM_IMPORT_ACTIVE_STATUSES,
	TELEGRAM_IMPORT_CHAT_TERMINAL_STATUSES,
	TELEGRAM_IMPORT_TERMINAL_STATUSES,
	createTelegramImportRun,
	failTelegramImportRunChat,
	findActiveTelegramImportRun,
	getLatestTelegramImportProgress,
	getLatestTelegramImportProgressWithHistory,
	getLatestTelegramImportRun,
	listChatIdsForTelegramImportRun,
	listContactIdsForTelegramImportRun,
	getOldestTelegramMessageId,
	getTelegramChatImportState,
	getTelegramImportRun,
	getTelegramImportRunChat,
	hasCurrentTelegramConsent,
	hasOpenTelegramImportChats,
	listQueuedTelegramImportRunChats,
	recordTelegramImportPage,
	requestTelegramImportCancel,
	requestTelegramImportPause,
	resumeTelegramImportRun,
	updateTelegramImportDiscoveryCounts,
	updateTelegramImportRunChatStatus,
	updateTelegramImportRunStatus,
	upsertTelegramImportRunChat,
} from './telegram-imports';
export type {
	CreateTelegramImportRunInput,
	TelegramChatImportState,
	TelegramImportChatStatus,
	TelegramImportProgress,
	TelegramImportProgressWithHistory,
	TelegramImportRun,
	TelegramImportRunChat,
	TelegramImportRunStatus,
} from './telegram-imports';

export {
	createRelationship,
	getRelationshipsForContact,
	getAllRelationships,
	updateRelationshipStrength,
	deriveGroupChatRelationships,
} from './relationships';
export type { CreateRelationshipInput, GetAllRelationshipsOptions } from './relationships';

export { getLatestSummary, upsertSummary, markSummaryStale } from './summaries';
export type { UpsertSummaryInput } from './summaries';

export {
	getPreferences,
	upsertPreferences,
	getWorkspaceIntroKeywords,
	getWorkspaceConnectionKeywords,
} from './user-preferences';
export type { UserPreferencesData, UpsertPreferencesInput } from './user-preferences';

export {
	createDigestPlaceholder,
	finalizeDigest,
	failDigest,
	getLatestDigest,
	listDigests,
} from './digests';
export type { CreateDigestInput } from './digests';

export { unifiedSearch } from './search';
export type { UnifiedSearchResult } from './search';

export {
	getDashboardAnalyticsStats,
	getDashboardStats,
	getUpcomingCommitments,
	getRecentActivity,
} from './dashboard';
export type {
	DashboardAnalyticsStats,
	DashboardStats,
	UpcomingCommitment,
	RecentActivityItem,
} from './dashboard';

export {
	upsertHealthScore,
	getHealthScore,
	getHealthScoresByWorkspace,
	getDecliningContacts,
} from './health-scores';
export type {
	UpsertHealthScoreInput,
	GetHealthScoresOptions,
	GetDecliningContactsOptions,
} from './health-scores';

export {
	createDraftLog,
	getDraftLog,
	markDraftSent,
	markDraftDiscarded,
	getPendingDrafts,
	getDraftStats,
} from './drafts';

export {
	createIntroduction,
	updateIntroduction,
	updateIntroductionStatus,
	listIntroductions,
	getIntroductionsByIntroducer,
	getIntroductionsByContact,
	getIntroducerLeaderboard,
} from './introductions';

export {
	createGoal,
	listGoals,
	getGoal,
	updateGoal,
	updateGoalProgress,
	updateGoalStatus,
	getActiveGoalsByType,
	listGoalProgressEvents,
	deleteGoal,
	getGoalAnalytics,
	isDuplicateGoal,
	createGoalProposal,
	confirmGoalProposal,
	dismissGoalProposal,
	listProposedGoals,
} from './goals';
export type {
	CreateGoalInput,
	UpdateGoalInput,
	GoalProgressSource,
	GoalAnalytics,
	GoalTypeStats,
	PaceDistribution,
} from './goals';
export type { GoalRow } from '../schema/goals';

export { trackBehavior, getBehaviorCounts } from './behaviors';

export {
	trackAnalyticsEvent,
	getOnboardingFunnel,
	getCommitmentPipelineStats,
	getEngagementMetrics,
} from './analytics';

export {
	createTokenMention,
	getTopMentionedTokens,
	getTokenMentionsByContact,
	addToWatchlist,
	getWatchlist,
	updateWatchlistPrice,
	removeFromWatchlist,
	incrementMentionCount,
} from './tokens';
export type { CreateTokenMentionInput } from './tokens';

export {
	createFollowUpPlan,
	activateFollowUpPlan,
	pauseFollowUpPlan,
	resumeFollowUpPlan,
	cancelFollowUpPlan,
	getReadySteps,
	advanceStep,
	skipStep,
	listFollowUpPlans,
	getFollowUpPlan,
	getFollowUpPlanSteps,
	autoPauseOnReply,
	approveStep,
	editAndApproveStep,
	rejectStep,
	FOLLOW_UP_PLAN_TEMPLATES,
} from './follow-up-plans';
export type { CreateFollowUpPlanInput, FollowUpPlanTemplate } from './follow-up-plans';

export {
	addDealParticipant,
	listDealParticipants,
	removeDealParticipant,
} from './deal-participants';
export type { CreateDealParticipantInput } from './deal-participants';

export { addDealArtifact, listDealArtifacts, removeDealArtifact } from './deal-artifacts';
export type { CreateDealArtifactInput } from './deal-artifacts';

export {
	createCalendarConnection,
	getCalendarConnection,
	updateCalendarTokens,
	updateCalendarLastSync,
	deleteCalendarConnection,
	upsertCalendarEvent,
	matchAttendeeToContact,
	listCalendarEvents,
	getUpcomingEvents,
	getEventCountByContact,
} from './calendar';
export type { UpsertCalendarEventInput } from './calendar';

export {
	isFeatureEnabled,
	setFeatureFlag,
	listFeatureFlags,
	deleteFeatureFlag,
	clearFlagCache,
} from './feature-flags';

export {
	appendAuditLog,
	queryAuditLogs,
	getAuditTrail,
	createAuditLogger,
} from './audit-log';
export type { AppendAuditLogInput, AuditLogFilters } from './audit-log';

export {
	getCalibration,
	getCalibrationCompletionStatus,
	upsertCalibration,
	getCalibrationForAI,
	saveWhatMatters,
	saveConsent,
	hasAnalyticsConsent,
	hasWorkspaceAiAnalysisConsent,
	hasUserAiAnalysisConsent,
	getMostActiveContacts,
	getMostNeglectedContacts,
} from './calibration';
export type {
	CalibrationInput,
	CalibrationCompletionStatus,
	UserCalibration,
	CalibrationContext,
	WhatMattersInput,
	ConsentInput,
	ContactSuggestion,
} from './calibration';

export {
	createKnowledgeNode,
	updateKnowledgeNode,
	incrementNodeMentionCount,
	getKnowledgeNode,
	listKnowledgeNodes,
	getKnowledgeNodeEvidenceStats,
	normalizeKnowledgeSearchQuery,
	DEFAULT_KNOWLEDGE_MESSAGE_RECALL_LIMIT,
	DEFAULT_KNOWLEDGE_MESSAGE_RECALL_MIN_SCORE,
	DEFAULT_KNOWLEDGE_MESSAGE_RECALL_NODE_LIMIT,
	DEFAULT_KNOWLEDGE_SEARCH_MIN_SIMILARITY,
	searchKnowledgeNodes,
	searchKnowledgeNodesWithEvidence,
	getLegacyKnowledgeEvidenceReport,
	repairKnowledgeEvidenceCounts,
	createKnowledgeEvidence,
	listEvidenceForKnowledgeNode,
	listEvidenceForKnowledgeNodes,
	listEvidenceForKnowledgeContact,
	listEvidenceForKnowledgeLink,
	linkContactToKnowledge,
	listContactsWithEvidenceForKnowledgeNode,
	listContactsByKnowledge,
	listContactIdsByKnowledge,
	listKnowledgeByContact,
	mergeKnowledgeNodes,
	deleteKnowledgeNode,
	findNodeByNameAnyType,
	findNodeByAlias,
	createKnowledgeLink,
	inferSimilarityLinks,
	getKnowledgeNeighbors,
	getSharedKnowledge,
	knowledgeGraphSearch,
	provenanceSearch,
	getGraphData,
	upsertExtractionLog,
	updateKnowledgeBackfillProgress,
	getExtractionLog,
	getContactsNeedingExtraction,
	getKnowledgeAnalysisContactCandidates,
} from './knowledge';
export type {
	KnowledgeNode,
	KnowledgeNodePublic,
	KnowledgeSearchResult,
	KnowledgeSearchResultWithEvidence,
	KnowledgeSearchEvidenceItem,
	KnowledgeSearchContactItem,
	SearchKnowledgeNodesWithEvidenceOptions,
	KnowledgeContact,
	KnowledgeEvidence,
	KnowledgeEvidenceKind,
	CreateKnowledgeEvidenceInput,
	KnowledgeContactEvidenceInput,
	KnowledgeLinkEvidenceInput,
	KnowledgeContactWithEvidence,
	LegacyKnowledgeEvidenceReport,
	LegacyKnowledgeEvidenceWorkspaceSummary,
	LegacyKnowledgeEvidenceNodeTypeSummary,
	LegacyKnowledgeEvidenceNodeGap,
	LegacyKnowledgeEvidenceContactGap,
	RepairKnowledgeEvidenceCountsResult,
	KnowledgeExtractionLogEntry,
	KnowledgeAnalysisContactCandidate,
	CreateKnowledgeNodeInput,
	UpdateKnowledgeNodeInput,
	ListKnowledgeNodesOptions,
	KnowledgeLink,
	KnowledgeLinkType,
	KnowledgeNeighbor,
	GraphSearchNode,
	ProvenanceResult,
} from './knowledge';
export {
	createRecommendations,
	getPendingRecommendations,
	actOnRecommendation,
	dismissRecommendation,
	expireOldRecommendations,
} from './recommendations';
export type {
	Recommendation,
	RecommendationType,
	CreateRecommendationItem,
} from './recommendations';
export {
	upsertInvestorProfile,
	getInvestorProfile,
	listInvestorProfiles,
	getTopInvestors,
} from './investor-profiles';
export type {
	InvestorProfile,
	UpsertInvestorProfileData,
	ListInvestorProfilesOptions,
} from './investor-profiles';
export {
	createOutcome,
	listOutcomes,
	searchOutcomes,
	getOutcomeStats,
	hasRecentOutcome,
} from './outcomes';
export type {
	Outcome,
	OutcomeType,
	OutcomeResult,
	CreateOutcomeInput,
	OutcomeStats,
} from './outcomes';
export { saveBrief, getLatestBrief, updateBriefFeedback } from './briefs';
export type { SaveBriefInput, LatestBrief } from './briefs';

export {
	upsertVoiceProfile,
	getVoiceProfile,
	markCalibrationComplete,
} from './voice-profiles';
export type { UpsertVoiceProfileInput } from './voice-profiles';

export {
	upsertContactStyleOverride,
	getContactStyleOverride,
	getContactStyleOverridesBatch,
	updateDeviationSignals,
} from './contact-style-overrides';
export type { UpsertContactStyleOverrideInput } from './contact-style-overrides';

export {
	createCorrectionDiff,
	getUnembeddedDiffs,
	updateDiffEmbedding,
	getUnclusteredDiffs,
	getAllDiffEmbeddings,
	assignPatternToDiffs,
	getDiffsByGoldenId,
} from './correction-diffs';
export type { CreateCorrectionDiffInput } from './correction-diffs';

export {
	createSemanticPattern,
	getTopPatterns,
	findSimilarPatterns as findSimilarSemanticPatterns,
	reinforcePattern,
} from './semantic-patterns';
export type { CreateSemanticPatternInput } from './semantic-patterns';

export {
	createConnection,
	updateConnectionStatus,
	listConnections,
	getConnectionsByContact,
	updateConnection,
	getDistinctEvents,
} from './connections';

export {
	createInvite,
	getInviteByToken,
	acceptInvite,
	listInvites,
	createWorkspace,
} from './invites';
export type { CreateInviteInput, InviteWithWorkspace } from './invites';

export { isWorkspaceMember, isWorkspaceOwner } from './workspace-access';

export { checkCache, storeCache, invalidateCache, cleanupExpiredCache } from './semantic-cache';
export type { CacheHit } from './semantic-cache';

export { deleteAccountData, deleteUserAccountOnly } from './delete-account';

export {
	createDealCandidate,
	listPendingCandidates,
	confirmCandidate,
	dismissCandidate,
	isDuplicateCandidate,
} from './deal-candidates';
export type { DealCandidate, CreateDealCandidateInput } from './deal-candidates';

export {
	createGoalAction,
	listGoalActions,
	updateGoalAction,
	completeGoalAction,
	deleteGoalAction,
} from './goal-actions';
export type { GoalAction, CreateGoalActionInput } from './goal-actions';
