/**
 * One-off fix: kms_context column was stored as a JSON string-in-JSONB
 * instead of a JSON object, causing SerializationException on KMS decrypt.
 *
 * Before: kms_context = '"{\\"WorkspaceID\\":\\"...\\"}"'  (JSON string)
 * After:  kms_context = '{"WorkspaceID":"..."}'            (JSON object)
 *
 * Safe to run multiple times — only updates rows where jsonb_typeof = 'string'.
 *
 * Run: node scripts/fix-kms-context.mjs
 */
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error('Missing DATABASE_URL');
	process.exit(1);
}

const sql = postgres(DATABASE_URL, { prepare: false });

try {
	// Check current state
	const rows = await sql`
    SELECT id, jsonb_typeof(kms_context) as kms_type, kms_context::text as kms_raw
    FROM workspaces
  `;

	console.log(`Found ${rows.length} workspace(s):\n`);
	for (const r of rows) {
		console.log(`  Workspace ${r.id}`);
		console.log(`    type: ${r.kms_type}`);
		console.log(`    raw:  ${r.kms_raw}`);
	}

	const toFix = rows.filter((r) => r.kms_type === 'string');
	if (toFix.length === 0) {
		console.log(
			'\n✅ All workspaces already have correct kms_context (object type). Nothing to fix.',
		);
		process.exit(0);
	}

	console.log(
		`\n⚠️  ${toFix.length} workspace(s) have kms_context stored as a JSON string. Fixing...\n`,
	);

	for (const r of toFix) {
		// Extract the inner JSON string value and re-parse as JSONB object
		// kms_context #>> '{}' extracts root JSON string value as text
		// Then ::jsonb re-parses it as a proper JSONB object
		const result = await sql`
      UPDATE workspaces
      SET kms_context = (kms_context #>> '{}')::jsonb
      WHERE id = ${r.id}
        AND jsonb_typeof(kms_context) = 'string'
      RETURNING id, jsonb_typeof(kms_context) as new_type, kms_context::text as new_raw
    `;

		if (result.length > 0) {
			console.log(`  ✅ Fixed workspace ${r.id}`);
			console.log(`     new type: ${result[0].new_type}`);
			console.log(`     new raw:  ${result[0].new_raw}`);
		} else {
			console.log(`  ⚠️  Workspace ${r.id} — no rows updated (already fixed?)`);
		}
	}

	// Verify
	console.log('\nVerifying fix...');
	const verify = await sql`
    SELECT id, jsonb_typeof(kms_context) as kms_type FROM workspaces
  `;
	const stillBroken = verify.filter((r) => r.kms_type !== 'object');
	if (stillBroken.length === 0) {
		console.log('✅ All workspaces now have kms_context as a JSON object.');
	} else {
		console.log(`❌ ${stillBroken.length} workspace(s) still have non-object kms_context:`);
		for (const r of stillBroken) {
			console.log(`  ${r.id}: ${r.kms_type}`);
		}
	}
} catch (err) {
	console.error('Error:', err.message);
	process.exit(1);
} finally {
	await sql.end();
}
