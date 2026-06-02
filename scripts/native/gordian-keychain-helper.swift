import Foundation
import LocalAuthentication
import Security

func fail(_ message: String, code: Int32 = 1) -> Never {
	FileHandle.standardError.write(Data((message + "\n").utf8))
	exit(code)
}

func usage() -> Never {
	fail("usage: gordian-keychain-helper <set|get> <service> <account> <mode> [operation-prompt]")
}

guard CommandLine.arguments.count >= 5 else {
	usage()
}

let action = CommandLine.arguments[1]
let service = CommandLine.arguments[2]
let account = CommandLine.arguments[3]
let mode = CommandLine.arguments[4]
let operationPrompt = CommandLine.arguments.count >= 6 ? CommandLine.arguments[5] : ""

guard action == "set" || action == "get" else {
	usage()
}

guard mode == "standard" || mode == "require-user-presence" || mode == "strict-user-presence" else {
	fail("invalid keychain mode")
}

let strictAuthContext: LAContext? = {
	guard mode == "strict-user-presence" else {
		return nil
	}
	let context = LAContext()
	context.localizedReason = operationPrompt.isEmpty
		? "Allow Gordian to access the local Telegram import session."
		: operationPrompt
	context.touchIDAuthenticationAllowableReuseDuration = 0
	return context
}()

var baseQuery: [String: Any] = [
	kSecClass as String: kSecClassGenericPassword,
	kSecAttrService as String: service,
	kSecAttrAccount as String: account,
]

func attributesForSet(input: Data) -> [String: Any] {
	var attributes: [String: Any] = [
		kSecValueData as String: input,
	]

	if mode == "strict-user-presence" {
		var error: Unmanaged<CFError>?
		guard let accessControl = SecAccessControlCreateWithFlags(
			nil,
			kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
			.userPresence,
			&error
		) else {
			let detail = error?.takeRetainedValue().localizedDescription ?? "unknown error"
			fail("SecAccessControlCreateWithFlags failed: \(detail)")
		}
		attributes[kSecAttrAccessControl as String] = accessControl
	} else if mode == "require-user-presence" {
		var access: SecAccess?
		let accessStatus = SecAccessCreate("Gordian Telegram import session" as CFString, nil, &access)
		guard accessStatus == errSecSuccess, let access else {
			fail("SecAccessCreate failed with status \(accessStatus)")
		}
		attributes[kSecAttrAccess as String] = access
	} else {
		attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
	}

	return attributes
}

if action == "set" {
	let input = FileHandle.standardInput.readDataToEndOfFile()
	guard !input.isEmpty else {
		fail("refusing to store empty keychain secret")
	}

	let attributes = attributesForSet(input: input)
	var addQuery = baseQuery
	for (key, value) in attributes {
		addQuery[key] = value
	}

	let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
	if addStatus == errSecSuccess {
		exit(0)
	}

	if addStatus == errSecDuplicateItem {
		let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
		if updateStatus == errSecSuccess {
			exit(0)
		}
		fail("SecItemUpdate failed with status \(updateStatus)")
	}

	fail("SecItemAdd failed with status \(addStatus)")
}

var readQuery = baseQuery
readQuery[kSecReturnData as String] = true
readQuery[kSecMatchLimit as String] = kSecMatchLimitOne
if !operationPrompt.isEmpty {
	if let strictAuthContext {
		readQuery[kSecUseAuthenticationContext as String] = strictAuthContext
	} else {
		readQuery[kSecUseOperationPrompt as String] = operationPrompt
	}
} else if let strictAuthContext {
	readQuery[kSecUseAuthenticationContext as String] = strictAuthContext
}

var item: CFTypeRef?
let status = SecItemCopyMatching(readQuery as CFDictionary, &item)
if status == errSecItemNotFound {
	fail("Keychain item could not be found")
}
if status != errSecSuccess {
	fail("SecItemCopyMatching failed with status \(status)")
}

guard let data = item as? Data else {
	fail("Keychain item did not contain data")
}

FileHandle.standardOutput.write(data)
