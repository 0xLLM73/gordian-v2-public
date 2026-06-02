#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from './lib/telegram-local-mode.mjs';

function usage() {
	console.log(`Usage: pnpm keychain-helper:xcode-project [options]

Creates a local Xcode project for the Gordian Keychain broker used by strict
Telegram Touch ID mode. The generated project lives outside the repo by default
so Xcode can add local signing metadata without risking a public commit.

Options:
  --out <path>           Output directory. Defaults to
                         ~/Library/Application Support/Gordian/GordianKeychainBrokerXcode.
  --bundle-id <id>       Bundle id. Defaults to dev.gordian.KeychainBroker.
  --team-id <id|auto>    Apple Team ID for local entitlements. Defaults to auto.
                         Use "none" only for source compile checks.
  --clean                Remove an existing generated project first.
  --help                 Show this help text.
`);
}

function infoPlist() {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDevelopmentRegion</key>
\t<string>$(DEVELOPMENT_LANGUAGE)</string>
\t<key>CFBundleExecutable</key>
\t<string>$(EXECUTABLE_NAME)</string>
\t<key>CFBundleIdentifier</key>
\t<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
\t<key>CFBundleInfoDictionaryVersion</key>
\t<string>6.0</string>
\t<key>CFBundleName</key>
\t<string>Gordian Keychain Broker</string>
\t<key>CFBundlePackageType</key>
\t<string>APPL</string>
\t<key>CFBundleShortVersionString</key>
\t<string>1.0</string>
\t<key>CFBundleVersion</key>
\t<string>1</string>
\t<key>LSUIElement</key>
\t<true/>
</dict>
</plist>
`;
}

function entitlements({ bundleId, teamId }) {
	const applicationIdentifier = teamId
		? `${teamId}.${bundleId}`
		: '$(AppIdentifierPrefix)$(PRODUCT_BUNDLE_IDENTIFIER)';
	const developerTeam = teamId || '$(DEVELOPMENT_TEAM)';
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.application-identifier</key>
\t<string>${applicationIdentifier}</string>
\t<key>com.apple.developer.team-identifier</key>
\t<string>${developerTeam}</string>
\t<key>com.apple.security.get-task-allow</key>
\t<true/>
</dict>
</plist>
`;
}

function developmentTeamBuildSetting(teamId) {
	return teamId ? `\n\t\t\t\tDEVELOPMENT_TEAM = "${teamId}";` : '';
}

function projectFile({ bundleId, teamId }) {
	return `// !$*UTF8*$!
{
\tarchiveVersion = 1;
\tclasses = {
\t};
\tobjectVersion = 56;
\tobjects = {

/* Begin PBXBuildFile section */
\t\tA00000000000000000000001 /* main.swift in Sources */ = {isa = PBXBuildFile; fileRef = A00000000000000000000002 /* main.swift */; };
/* End PBXBuildFile section */

/* Begin PBXFileReference section */
\t\tA00000000000000000000002 /* main.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = main.swift; sourceTree = "<group>"; };
\t\tA00000000000000000000003 /* Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; };
\t\tA00000000000000000000004 /* GordianKeychainBroker.entitlements */ = {isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = GordianKeychainBroker.entitlements; sourceTree = "<group>"; };
\t\tA00000000000000000000005 /* GordianKeychainBroker.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = GordianKeychainBroker.app; sourceTree = BUILT_PRODUCTS_DIR; };
/* End PBXFileReference section */

/* Begin PBXFrameworksBuildPhase section */
\t\tA00000000000000000000006 /* Frameworks */ = {
\t\t\tisa = PBXFrameworksBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t};
/* End PBXFrameworksBuildPhase section */

/* Begin PBXGroup section */
\t\tA00000000000000000000007 = {
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\tA00000000000000000000008 /* GordianKeychainBroker */,
\t\t\t\tA00000000000000000000009 /* Products */,
\t\t\t);
\t\t\tsourceTree = "<group>";
\t\t};
\t\tA00000000000000000000008 /* GordianKeychainBroker */ = {
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\tA00000000000000000000002 /* main.swift */,
\t\t\t\tA00000000000000000000003 /* Info.plist */,
\t\t\t\tA00000000000000000000004 /* GordianKeychainBroker.entitlements */,
\t\t\t);
\t\t\tpath = GordianKeychainBroker;
\t\t\tsourceTree = "<group>";
\t\t};
\t\tA00000000000000000000009 /* Products */ = {
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\tA00000000000000000000005 /* GordianKeychainBroker.app */,
\t\t\t);
\t\t\tname = Products;
\t\t\tsourceTree = "<group>";
\t\t};
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
\t\tA0000000000000000000000A /* GordianKeychainBroker */ = {
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = A0000000000000000000000B /* Build configuration list for PBXNativeTarget "GordianKeychainBroker" */;
\t\t\tbuildPhases = (
\t\t\t\tA0000000000000000000000C /* Sources */,
\t\t\t\tA00000000000000000000006 /* Frameworks */,
\t\t\t);
\t\t\tbuildRules = (
\t\t\t);
\t\t\tdependencies = (
\t\t\t);
\t\t\tname = GordianKeychainBroker;
\t\t\tproductName = GordianKeychainBroker;
\t\t\tproductReference = A00000000000000000000005 /* GordianKeychainBroker.app */;
\t\t\tproductType = "com.apple.product-type.application";
\t\t};
/* End PBXNativeTarget section */

/* Begin PBXProject section */
\t\tA0000000000000000000000D /* Project object */ = {
\t\t\tisa = PBXProject;
\t\t\tattributes = {
\t\t\t\tBuildIndependentTargetsInParallel = 1;
\t\t\t\tLastSwiftUpdateCheck = 2650;
\t\t\t\tLastUpgradeCheck = 2650;
\t\t\t\tTargetAttributes = {
\t\t\t\t\tA0000000000000000000000A = {
\t\t\t\t\t\tCreatedOnToolsVersion = 26.5;
\t\t\t\t\t};
\t\t\t\t};
\t\t\t};
\t\t\tbuildConfigurationList = A0000000000000000000000E /* Build configuration list for PBXProject "GordianKeychainBroker" */;
\t\t\tcompatibilityVersion = "Xcode 14.0";
\t\t\tdevelopmentRegion = en;
\t\t\thasScannedForEncodings = 0;
\t\t\tknownRegions = (
\t\t\t\ten,
\t\t\t\tBase,
\t\t\t);
\t\t\tmainGroup = A00000000000000000000007;
\t\t\tproductRefGroup = A00000000000000000000009 /* Products */;
\t\t\tprojectDirPath = "";
\t\t\tprojectRoot = "";
\t\t\ttargets = (
\t\t\t\tA0000000000000000000000A /* GordianKeychainBroker */,
\t\t\t);
\t\t};
/* End PBXProject section */

/* Begin PBXSourcesBuildPhase section */
\t\tA0000000000000000000000C /* Sources */ = {
\t\t\tisa = PBXSourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
\t\t\t\tA00000000000000000000001 /* main.swift in Sources */,
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t};
/* End PBXSourcesBuildPhase section */

/* Begin XCBuildConfiguration section */
\t\tA0000000000000000000000F /* Debug */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tALWAYS_SEARCH_USER_PATHS = NO;
\t\t\t\tCLANG_ANALYZER_NONNULL = YES;
\t\t\t\tCLANG_ANALYZER_NUMBER_OBJECT_CONVERSION = YES_AGGRESSIVE;
\t\t\t\tCLANG_CXX_LANGUAGE_STANDARD = "gnu++20";
\t\t\t\tCLANG_ENABLE_MODULES = YES;
\t\t\t\tCLANG_ENABLE_OBJC_ARC = YES;
\t\t\t\tCLANG_WARN_BLOCK_CAPTURE_AUTORELEASING = YES;
\t\t\t\tCLANG_WARN_BOOL_CONVERSION = YES;
\t\t\t\tCLANG_WARN_COMMA = YES;
\t\t\t\tCLANG_WARN_CONSTANT_CONVERSION = YES;
\t\t\t\tCLANG_WARN_DEPRECATED_OBJC_IMPLEMENTATIONS = YES;
\t\t\t\tCLANG_WARN_DIRECT_OBJC_ISA_USAGE = YES_ERROR;
\t\t\t\tCLANG_WARN_DOCUMENTATION_COMMENTS = YES;
\t\t\t\tCLANG_WARN_EMPTY_BODY = YES;
\t\t\t\tCLANG_WARN_ENUM_CONVERSION = YES;
\t\t\t\tCLANG_WARN_INFINITE_RECURSION = YES;
\t\t\t\tCLANG_WARN_INT_CONVERSION = YES;
\t\t\t\tCLANG_WARN_NON_LITERAL_NULL_CONVERSION = YES;
\t\t\t\tCLANG_WARN_OBJC_IMPLICIT_RETAIN_SELF = YES;
\t\t\t\tCLANG_WARN_OBJC_LITERAL_CONVERSION = YES;
\t\t\t\tCLANG_WARN_OBJC_ROOT_CLASS = YES_ERROR;
\t\t\t\tCLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER = YES;
\t\t\t\tCLANG_WARN_RANGE_LOOP_ANALYSIS = YES;
\t\t\t\tCLANG_WARN_STRICT_PROTOTYPES = YES;
\t\t\t\tCLANG_WARN_SUSPICIOUS_MOVE = YES;
\t\t\t\tCLANG_WARN_UNGUARDED_AVAILABILITY = YES_AGGRESSIVE;
\t\t\t\tCLANG_WARN_UNREACHABLE_CODE = YES;
\t\t\t\tCLANG_WARN__DUPLICATE_METHOD_MATCH = YES;
\t\t\t\tCOPY_PHASE_STRIP = NO;
\t\t\t\tDEBUG_INFORMATION_FORMAT = dwarf;
\t\t\t\tENABLE_STRICT_OBJC_MSGSEND = YES;
\t\t\t\tENABLE_TESTABILITY = YES;
\t\t\t\tGCC_C_LANGUAGE_STANDARD = gnu17;
\t\t\t\tGCC_DYNAMIC_NO_PIC = NO;
\t\t\t\tGCC_NO_COMMON_BLOCKS = YES;
\t\t\t\tGCC_OPTIMIZATION_LEVEL = 0;
\t\t\t\tGCC_PREPROCESSOR_DEFINITIONS = (
\t\t\t\t\t"DEBUG=1",
\t\t\t\t\t"$(inherited)",
\t\t\t\t);
\t\t\t\tGCC_WARN_64_TO_32_BIT_CONVERSION = YES;
\t\t\t\tGCC_WARN_ABOUT_RETURN_TYPE = YES_ERROR;
\t\t\t\tGCC_WARN_UNDECLARED_SELECTOR = YES;
\t\t\t\tGCC_WARN_UNINITIALIZED_AUTOS = YES_AGGRESSIVE;
\t\t\t\tGCC_WARN_UNUSED_FUNCTION = YES;
\t\t\t\tGCC_WARN_UNUSED_VARIABLE = YES;
\t\t\t\tMACOSX_DEPLOYMENT_TARGET = 13.0;
\t\t\t\tMTL_ENABLE_DEBUG_INFO = INCLUDE_SOURCE;
\t\t\t\tMTL_FAST_MATH = YES;
\t\t\t\tONLY_ACTIVE_ARCH = YES;
\t\t\t\tSDKROOT = macosx;
\t\t\t\tSWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;
\t\t\t\tSWIFT_OPTIMIZATION_LEVEL = "-Onone";
\t\t\t};
\t\t\tname = Debug;
\t\t};
\t\tA00000000000000000000010 /* Release */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tALWAYS_SEARCH_USER_PATHS = NO;
\t\t\t\tCLANG_ANALYZER_NONNULL = YES;
\t\t\t\tCLANG_ANALYZER_NUMBER_OBJECT_CONVERSION = YES_AGGRESSIVE;
\t\t\t\tCLANG_CXX_LANGUAGE_STANDARD = "gnu++20";
\t\t\t\tCLANG_ENABLE_MODULES = YES;
\t\t\t\tCLANG_ENABLE_OBJC_ARC = YES;
\t\t\t\tCLANG_WARN_BLOCK_CAPTURE_AUTORELEASING = YES;
\t\t\t\tCLANG_WARN_BOOL_CONVERSION = YES;
\t\t\t\tCLANG_WARN_COMMA = YES;
\t\t\t\tCLANG_WARN_CONSTANT_CONVERSION = YES;
\t\t\t\tCLANG_WARN_DEPRECATED_OBJC_IMPLEMENTATIONS = YES;
\t\t\t\tCLANG_WARN_DIRECT_OBJC_ISA_USAGE = YES_ERROR;
\t\t\t\tCLANG_WARN_DOCUMENTATION_COMMENTS = YES;
\t\t\t\tCLANG_WARN_EMPTY_BODY = YES;
\t\t\t\tCLANG_WARN_ENUM_CONVERSION = YES;
\t\t\t\tCLANG_WARN_INFINITE_RECURSION = YES;
\t\t\t\tCLANG_WARN_INT_CONVERSION = YES;
\t\t\t\tCLANG_WARN_NON_LITERAL_NULL_CONVERSION = YES;
\t\t\t\tCLANG_WARN_OBJC_IMPLICIT_RETAIN_SELF = YES;
\t\t\t\tCLANG_WARN_OBJC_LITERAL_CONVERSION = YES;
\t\t\t\tCLANG_WARN_OBJC_ROOT_CLASS = YES_ERROR;
\t\t\t\tCLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER = YES;
\t\t\t\tCLANG_WARN_RANGE_LOOP_ANALYSIS = YES;
\t\t\t\tCLANG_WARN_STRICT_PROTOTYPES = YES;
\t\t\t\tCLANG_WARN_SUSPICIOUS_MOVE = YES;
\t\t\t\tCLANG_WARN_UNGUARDED_AVAILABILITY = YES_AGGRESSIVE;
\t\t\t\tCLANG_WARN_UNREACHABLE_CODE = YES;
\t\t\t\tCLANG_WARN__DUPLICATE_METHOD_MATCH = YES;
\t\t\t\tCOPY_PHASE_STRIP = NO;
\t\t\t\tDEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";
\t\t\t\tENABLE_NS_ASSERTIONS = NO;
\t\t\t\tENABLE_STRICT_OBJC_MSGSEND = YES;
\t\t\t\tGCC_C_LANGUAGE_STANDARD = gnu17;
\t\t\t\tGCC_NO_COMMON_BLOCKS = YES;
\t\t\t\tGCC_WARN_64_TO_32_BIT_CONVERSION = YES;
\t\t\t\tGCC_WARN_ABOUT_RETURN_TYPE = YES_ERROR;
\t\t\t\tGCC_WARN_UNDECLARED_SELECTOR = YES;
\t\t\t\tGCC_WARN_UNINITIALIZED_AUTOS = YES_AGGRESSIVE;
\t\t\t\tGCC_WARN_UNUSED_FUNCTION = YES;
\t\t\t\tGCC_WARN_UNUSED_VARIABLE = YES;
\t\t\t\tMACOSX_DEPLOYMENT_TARGET = 13.0;
\t\t\t\tMTL_ENABLE_DEBUG_INFO = NO;
\t\t\t\tMTL_FAST_MATH = YES;
\t\t\t\tSDKROOT = macosx;
\t\t\t\tSWIFT_COMPILATION_MODE = wholemodule;
\t\t\t\tSWIFT_OPTIMIZATION_LEVEL = "-O";
\t\t\t};
\t\t\tname = Release;
\t\t};
\t\tA00000000000000000000011 /* Debug */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tCODE_SIGN_ENTITLEMENTS = GordianKeychainBroker/GordianKeychainBroker.entitlements;
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tCOMBINE_HIDPI_IMAGES = YES;
\t\t\t\tCONFIGURATION_BUILD_DIR = "$(PROJECT_DIR)/Build/Products/$(CONFIGURATION)";
\t\t\t\tCURRENT_PROJECT_VERSION = 1;${developmentTeamBuildSetting(teamId)}
\t\t\t\tDEVELOPMENT_ASSET_PATHS = "";
\t\t\t\tENABLE_HARDENED_RUNTIME = YES;
\t\t\t\tGENERATE_INFOPLIST_FILE = NO;
\t\t\t\tINFOPLIST_FILE = GordianKeychainBroker/Info.plist;
\t\t\t\tLD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/../Frameworks";
\t\t\t\tMACOSX_DEPLOYMENT_TARGET = 13.0;
\t\t\t\tMARKETING_VERSION = 1.0;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "${bundleId}";
\t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";
\t\t\t\tSDKROOT = macosx;
\t\t\t\tSWIFT_VERSION = 5.0;
\t\t\t};
\t\t\tname = Debug;
\t\t};
\t\tA00000000000000000000012 /* Release */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tCODE_SIGN_ENTITLEMENTS = GordianKeychainBroker/GordianKeychainBroker.entitlements;
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tCOMBINE_HIDPI_IMAGES = YES;
\t\t\t\tCONFIGURATION_BUILD_DIR = "$(PROJECT_DIR)/Build/Products/$(CONFIGURATION)";
\t\t\t\tCURRENT_PROJECT_VERSION = 1;${developmentTeamBuildSetting(teamId)}
\t\t\t\tDEVELOPMENT_ASSET_PATHS = "";
\t\t\t\tENABLE_HARDENED_RUNTIME = YES;
\t\t\t\tGENERATE_INFOPLIST_FILE = NO;
\t\t\t\tINFOPLIST_FILE = GordianKeychainBroker/Info.plist;
\t\t\t\tLD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/../Frameworks";
\t\t\t\tMACOSX_DEPLOYMENT_TARGET = 13.0;
\t\t\t\tMARKETING_VERSION = 1.0;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "${bundleId}";
\t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";
\t\t\t\tSDKROOT = macosx;
\t\t\t\tSWIFT_VERSION = 5.0;
\t\t\t};
\t\t\tname = Release;
\t\t};
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
\t\tA0000000000000000000000E /* Build configuration list for PBXProject "GordianKeychainBroker" */ = {
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\tA0000000000000000000000F /* Debug */,
\t\t\t\tA00000000000000000000010 /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t};
\t\tA0000000000000000000000B /* Build configuration list for PBXNativeTarget "GordianKeychainBroker" */ = {
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\tA00000000000000000000011 /* Debug */,
\t\t\t\tA00000000000000000000012 /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t};
/* End XCConfigurationList section */
\t};
\trootObject = A0000000000000000000000D /* Project object */;
}
`;
}

function readme({ bundleId, out, teamId }) {
	const projectPath = resolve(out, 'GordianKeychainBroker.xcodeproj');
	const helperPath = resolve(
		out,
		'Build/Products/Debug/GordianKeychainBroker.app/Contents/MacOS/GordianKeychainBroker',
	);
	return `# Gordian Keychain Broker

This generated Xcode project is local-only. Do not commit generated build
products, provisioning profiles, certificates, or signing metadata.

1. Open ${projectPath} in Xcode.
2. Select the GordianKeychainBroker target.
3. Open Signing & Capabilities.
4. Select your Apple Personal Team.
5. Build the Debug target.

The broker bundle id is:

\`\`\`text
${bundleId}
\`\`\`

The local Apple Team ID written into this generated project is:

\`\`\`text
${teamId || 'none'}
\`\`\`

After Xcode builds successfully, use this helper path:

\`\`\`bash
GORDIAN_KEYCHAIN_HELPER_PATH="${helperPath}"
pnpm keychain-helper:doctor -- --helper "$GORDIAN_KEYCHAIN_HELPER_PATH" --require-strict-ready
pnpm telegram:touchid:probe -- --helper "$GORDIAN_KEYCHAIN_HELPER_PATH"
\`\`\`
`;
}

function detectAppleDevelopmentTeamId() {
	if (process.platform !== 'darwin') return '';
	try {
		const certs = execFileSync(
			'security',
			['find-certificate', '-a', '-c', 'Apple Development', '-p'],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
		);
		const pemBlocks = certs.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
		for (const pem of pemBlocks || []) {
			const subject = execFileSync('openssl', ['x509', '-noout', '-subject'], {
				encoding: 'utf8',
				input: pem,
				stdio: ['pipe', 'pipe', 'ignore'],
			});
			const match = subject.match(/OU\s*=\s*([A-Z0-9]{10})/);
			if (match) return match[1];
		}
	} catch {
		return '';
	}
	return '';
}

function resolveTeamId(rawTeamId) {
	const requested = String(rawTeamId || 'auto');
	if (requested === 'none') return '';
	const teamId = requested === 'auto' ? detectAppleDevelopmentTeamId() : requested;
	if (!teamId) return '';
	if (!/^[A-Z0-9]{10}$/.test(teamId)) {
		throw new Error(`Invalid Apple Team ID: ${teamId}`);
	}
	return teamId;
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		usage();
		return;
	}

	const out = resolve(
		String(
			args.out ||
				resolve(homedir(), 'Library/Application Support/Gordian/GordianKeychainBrokerXcode'),
		),
	);
	const bundleId = String(args['bundle-id'] || 'dev.gordian.KeychainBroker');
	if (!/^[A-Za-z0-9][A-Za-z0-9.-]+$/.test(bundleId)) {
		throw new Error(`Invalid bundle id: ${bundleId}`);
	}
	const teamId = resolveTeamId(args['team-id']);

	if (existsSync(out) && args.clean) {
		rmSync(out, { force: true, recursive: true });
	}
	if (existsSync(out) && !args.clean) {
		throw new Error(`${out} already exists. Rerun with --clean to replace it.`);
	}

	const sourceDir = resolve(out, 'GordianKeychainBroker');
	const projectDir = resolve(out, 'GordianKeychainBroker.xcodeproj');
	mkdirSync(sourceDir, { recursive: true });
	mkdirSync(projectDir, { recursive: true });

	copyFileSync(
		resolve('scripts/native/gordian-keychain-helper.swift'),
		resolve(sourceDir, 'main.swift'),
	);
	writeFileSync(resolve(sourceDir, 'Info.plist'), infoPlist());
	writeFileSync(
		resolve(sourceDir, 'GordianKeychainBroker.entitlements'),
		entitlements({ bundleId, teamId }),
	);
	writeFileSync(resolve(projectDir, 'project.pbxproj'), projectFile({ bundleId, teamId }));
	writeFileSync(resolve(out, 'README.md'), readme({ bundleId, out, teamId }));

	const projectPath = resolve(projectDir);
	const helperPath = resolve(
		out,
		'Build/Products/Debug/GordianKeychainBroker.app/Contents/MacOS/GordianKeychainBroker',
	);

	console.log(`[keychain-helper:xcode-project] Created ${projectPath}`);
	if (teamId) {
		console.log(`[keychain-helper:xcode-project] Using local Apple Team ID ${teamId}`);
	} else {
		console.log(
			'[keychain-helper:xcode-project] No Apple Team ID detected; rerun with --team-id <id> before strict mode.',
		);
	}
	if (process.platform === 'darwin') {
		console.log(`Open it with: open ${JSON.stringify(projectPath)}`);
	} else {
		console.log('Open this project on macOS with Xcode automatic signing enabled.');
	}
	console.log(`After Xcode builds Debug, set GORDIAN_KEYCHAIN_HELPER_PATH="${helperPath}"`);
	console.log(
		'Then run pnpm keychain-helper:doctor -- --require-strict-ready and pnpm telegram:touchid:probe before enabling strict mode.',
	);
	console.log(`Local instructions: ${resolve(out, 'README.md')}`);
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
