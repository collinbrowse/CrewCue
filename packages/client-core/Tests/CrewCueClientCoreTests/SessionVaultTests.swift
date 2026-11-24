import Foundation
import Testing
@testable import CrewCueClientCore

private let ada = ClientSession(userId: "ada", role: "athlete", roomId: "room-1", displayName: "Ada", accessToken: "token-ada")

private func tempDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("vault-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

private func writeLegacySession(_ session: ClientSession, directory: URL) throws {
    try JSONEncoder().encode(session).write(to: SessionFile.url(directory: directory))
}

private func writeMarker(directory: URL) throws {
    try Data().write(to: SessionVaultLaunch.markerURL(directory: directory))
}

private struct FailingVault: SessionVault {
    struct Failure: Error {}
    func load() throws -> ClientSession? { throw Failure() }
    func save(_ session: ClientSession) throws { throw Failure() }
    func wipe() throws {}
}

/// A vault holding `ada` whose `load` throws `loadError`, recording whether `wipe` ran.
private final class ThrowingLoadVault: SessionVault, @unchecked Sendable {
    let loadError: any Error
    private(set) var wiped = false

    init(loadError: any Error) {
        self.loadError = loadError
    }

    func load() throws -> ClientSession? { throw loadError }
    func save(_ session: ClientSession) throws {}
    func wipe() throws { wiped = true }
}

@Test func anUnavailableVaultKeepsTheStoredSessionForTheNextLaunch() throws {
    let directory = try tempDirectory()
    try writeMarker(directory: directory)
    let vault = ThrowingLoadVault(loadError: SessionVaultUnavailable(code: -25308))

    #expect(SessionVaultLaunch.restore(vault: vault, directory: directory) == nil)
    #expect(!vault.wiped)
}

@Test func anUnreadableVaultValueIsWiped() throws {
    let directory = try tempDirectory()
    try writeMarker(directory: directory)
    let vault = ThrowingLoadVault(loadError: FailingVault.Failure())

    #expect(SessionVaultLaunch.restore(vault: vault, directory: directory) == nil)
    #expect(vault.wiped)
}

@Test func vaultSavesLoadsAndWipesASession() throws {
    let vault = InMemorySessionVault()
    #expect(try vault.load() == nil)
    try vault.save(ada)
    #expect(try vault.load() == ada)
    var renamed = ada
    renamed.displayName = "Ada L"
    try vault.save(renamed)
    #expect(try vault.load() == renamed)
    try vault.wipe()
    #expect(try vault.load() == nil)
}

@Test func launchMovesTheLegacyFileIntoTheVaultAndDeletesIt() throws {
    let directory = try tempDirectory()
    try writeLegacySession(ada, directory: directory)
    let vault = InMemorySessionVault()

    let restored = SessionVaultLaunch.restore(vault: vault, directory: directory)

    #expect(restored == ada)
    #expect(try vault.load() == ada)
    #expect(!FileManager.default.fileExists(atPath: SessionFile.url(directory: directory).path))
    #expect(FileManager.default.fileExists(atPath: SessionVaultLaunch.markerURL(directory: directory).path))
    // The next launch reads the vault, not a file.
    #expect(SessionVaultLaunch.restore(vault: vault, directory: directory) == ada)
}

@Test func launchWithoutAnInstallMarkerClearsALeftoverVaultSession() throws {
    let directory = try tempDirectory()
    let vault = InMemorySessionVault(ada)

    #expect(SessionVaultLaunch.restore(vault: vault, directory: directory) == nil)
    #expect(try vault.load() == nil)
    #expect(FileManager.default.fileExists(atPath: SessionVaultLaunch.markerURL(directory: directory).path))
}

@Test func launchWithAnInstallMarkerKeepsTheVaultSession() throws {
    let directory = try tempDirectory()
    try writeMarker(directory: directory)
    let vault = InMemorySessionVault(ada)

    #expect(SessionVaultLaunch.restore(vault: vault, directory: directory) == ada)
}

@Test func anUnreadableLegacyFileIsDeletedAndLeavesTheUserSignedOut() throws {
    let directory = try tempDirectory()
    try writeMarker(directory: directory)
    try Data("not json".utf8).write(to: SessionFile.url(directory: directory))
    let vault = InMemorySessionVault()

    #expect(SessionVaultLaunch.restore(vault: vault, directory: directory) == nil)
    #expect(!FileManager.default.fileExists(atPath: SessionFile.url(directory: directory).path))
}

@Test func aVaultThatRejectsTheMigrationStillDeletesTheFileAndKeepsThisLaunchSignedIn() throws {
    let directory = try tempDirectory()
    try writeMarker(directory: directory)
    try writeLegacySession(ada, directory: directory)

    #expect(SessionVaultLaunch.restore(vault: FailingVault(), directory: directory) == ada)
    #expect(!FileManager.default.fileExists(atPath: SessionFile.url(directory: directory).path))
}

@Test func signOutWipesTheVaultThroughItsRegisteredStore() throws {
    let vault = InMemorySessionVault(ada)
    let controller = SessionController(session: ada)
    controller.register(id: "session-vault") { try vault.wipe() }

    try controller.expire()

    #expect(controller.session == nil)
    #expect(try vault.load() == nil)
}
