import { buildKnowledgeModelEvalReport } from './lib/knowledge-model-eval';

const report = buildKnowledgeModelEvalReport();

console.log(`Knowledge model eval: ${report.status}`);
console.log(`Model cases: ${report.summary.modelCasesPassed}/${report.summary.modelCases} passed`);
console.log(
	`Evidence retrieval cases: ${report.summary.retrievalCasesPassed}/${report.summary.retrievalCases} passed`,
);
console.log(`Safety violations: ${report.summary.safetyViolations}`);

for (const result of report.modelResults) {
	const status = result.passed ? 'PASS' : 'FAIL';
	console.log(
		[
			status,
			result.modelId,
			result.fixtureId,
			`entityRecall=${result.entityRecall}`,
			`relationRecall=${result.relationRecall}`,
			`quoteRate=${result.quoteVerificationRate}`,
			`promotable=${result.promotableActual}/${result.promotableExpected}`,
		].join('  '),
	);
	for (const violation of result.safetyViolations) {
		console.log(`  safety: ${violation}`);
	}
}

for (const result of report.retrievalResults) {
	const status = result.passed ? 'PASS' : 'FAIL';
	console.log(
		[
			status,
			'evidence-retrieval',
			result.caseId,
			`recall@${result.k}=${result.recallAtK}`,
			`topExact=${result.topChunkExact}`,
		].join('  '),
	);
	for (const leak of result.unsafeFieldLeaks) {
		console.log(`  unsafe-field: ${leak}`);
	}
}

console.log(`KNOWLEDGE_MODEL_EVAL_JSON=${JSON.stringify(report)}`);

if (report.status !== 'passed') {
	process.exitCode = 1;
}
