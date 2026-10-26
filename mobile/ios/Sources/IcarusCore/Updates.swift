import Foundation
#if canImport(CryptoKit)
import CryptoKit
#endif

/// Versiones y manifiesto de actualización, igual que electron/update (escritorio) y
/// el núcleo de Android. Los vectores de mobile/shared/test-vectors/updates.json
/// comprueban que las tres plataformas deciden lo mismo.
///
/// En iPhone y iPad solo se usa para AVISAR: iOS no permite que una app se instale a
/// sí misma, así que la versión nueva se instala por el canal oficial (App Store o
/// TestFlight) o, en una copia instalada a mano, volviendo a firmar el .ipa.
public struct UpdateVersion: Comparable, CustomStringConvertible {
    public let major: Int
    public let minor: Int
    public let patch: Int
    public let preview: Int?

    public init(major: Int, minor: Int, patch: Int, preview: Int?) {
        self.major = major
        self.minor = minor
        self.patch = patch
        self.preview = preview
    }

    private static let pattern = Pattern("^(0|[1-9]\\d{0,3})\\.(0|[1-9]\\d?)\\.(0|[1-9]\\d?)(?:-preview\\.([1-9]\\d?))?$")

    public static func parse(_ text: String?) -> UpdateVersion? {
        guard let text, pattern.matches(text), let groups = pattern.groups(text) else { return nil }
        let version = UpdateVersion(major: Int(groups[1])!, minor: Int(groups[2])!, patch: Int(groups[3])!, preview: groups[4].isEmpty ? nil : Int(groups[4]))
        if version.major > 2000 || (version.preview ?? 0) > 98 { return nil }
        return version
    }

    /// El mismo código que Android (y CFBundleVersion): ((mayor·100 + menor)·100 + parche)·100 + (preliminar o 99).
    public var versionCode: Int { ((major * 100 + minor) * 100 + patch) * 100 + (preview ?? 99) }

    public var description: String { "\(major).\(minor).\(patch)" + (preview.map { "-preview.\($0)" } ?? "") }

    public static func < (a: UpdateVersion, b: UpdateVersion) -> Bool {
        (a.major, a.minor, a.patch, a.preview ?? Int.max) < (b.major, b.minor, b.patch, b.preview ?? Int.max)
    }
}

public enum UpdateChannel: String, CaseIterable {
    case stable, preview
}

public struct UpdateAsset: Equatable {
    public let platform: String
    public let arch: String
    public let kind: String
    public let file: String
    public let size: Int64
    public let sha256: String
    public let versionCode: Int?
}

public struct UpdateManifest {
    public let version: String
    public let channel: UpdateChannel
    public let tag: String
    public let commit: String
    public let releasedAt: Date
    public let notes: String
    public let assets: [UpdateAsset]
}

public enum ManifestResult {
    case ok(UpdateManifest, UpdateVersion)
    /// not-json, schema, product, version, channel, tag, commit, date, notes o assets.
    case invalid(String)
}

public enum UpdateDecision: Equatable {
    case upToDate
    case available(UpdateAsset?)
    /// older, channel o no-asset.
    case rejected(String)
}

public enum UpdateManifests {
    public static let manifestFile = "icarus-update.json"
    public static let signatureFile = "icarus-update.json.sig"
    public static let maxManifestBytes = 256 * 1024
    public static let maxSignatureBytes = 1024

    private static let platforms: Set<String> = ["windows", "macos", "linux", "android", "ios"]
    private static let arches: Set<String> = ["x64", "arm64", "universal"]
    private static let extensions = ["nsis": "exe", "zip": "zip", "dmg": "dmg", "apk": "apk", "ipa": "ipa"]
    private static let fileName = Pattern("^ICARUS-Browser-[A-Za-z0-9._-]{1,80}\\.(exe|zip|dmg|apk|ipa)$")
    private static let sha256 = Pattern("^[0-9a-f]{64}$")
    private static let commit = Pattern("^[0-9a-f]{40}$")
    private static let isoDate = Pattern("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z$")

    /// Número entero de JSON (los decimales y los booleanos no valen).
    private static func integer(_ value: Any?) -> Int64? {
        guard let number = value as? NSNumber else { return nil }
        guard ["s", "i", "l", "q", "S", "I", "L", "Q"].contains(String(cString: number.objCType)) else { return nil }
        return number.int64Value
    }

    private static func date(_ text: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = text.contains(".") ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
        return formatter.date(from: text)
    }

    private static func readAsset(_ raw: Any, version: String) -> UpdateAsset? {
        guard let item = raw as? [String: Any],
              let platform = item["platform"] as? String, platforms.contains(platform),
              let arch = item["arch"] as? String, arches.contains(arch),
              let kind = item["kind"] as? String, let ext = extensions[kind],
              let file = item["file"] as? String, fileName.matches(file), !file.contains(".."),
              // El nombre debe corresponder a la versión y al tipo de paquete.
              file.contains(version), file.hasSuffix(".\(ext)"),
              let size = integer(item["size"]), size > 0, size <= 1024 * 1024 * 1024,
              let hash = item["sha256"] as? String, sha256.matches(hash)
        else { return nil }
        var versionCode: Int?
        if platform == "android" {
            guard let code = integer(item["versionCode"]), code > 0, code <= Int64(Int32.max) else { return nil }
            versionCode = Int(code)
        } else if item.keys.contains("versionCode") {
            return nil
        }
        return UpdateAsset(platform: platform, arch: arch, kind: kind, file: file, size: size, sha256: hash, versionCode: versionCode)
    }

    /// Valida un manifiesto ya leído como texto (los bytes firmados).
    public static func parse(_ text: String) -> ManifestResult {
        guard let data = text.data(using: .utf8),
              let raw = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return .invalid("not-json") }
        guard integer(raw["schema"]) == 1 else { return .invalid("schema") }
        guard raw["product"] as? String == "icarus-browser" else { return .invalid("product") }
        guard let versionText = raw["version"] as? String, let version = UpdateVersion.parse(versionText) else { return .invalid("version") }
        guard let channelText = raw["channel"] as? String, let channel = UpdateChannel(rawValue: channelText) else { return .invalid("channel") }
        // Una versión preliminar nunca se presenta como estable, ni al revés.
        guard (channel == .stable) == (version.preview == nil) else { return .invalid("channel") }
        guard raw["tag"] as? String == "v\(versionText)" else { return .invalid("tag") }
        guard let commitText = raw["commit"] as? String, commit.matches(commitText) else { return .invalid("commit") }
        guard let dateText = raw["releasedAt"] as? String, isoDate.matches(dateText), let releasedAt = date(dateText) else { return .invalid("date") }
        guard let notes = raw["notes"] as? String, notes.utf16.count <= 20_000 else { return .invalid("notes") }
        guard let list = raw["assets"] as? [Any], !list.isEmpty, list.count <= 40 else { return .invalid("assets") }
        var assets: [UpdateAsset] = []
        var keys = Set<String>()
        for item in list {
            guard let asset = readAsset(item, version: versionText) else { return .invalid("assets") }
            guard keys.insert("\(asset.platform)/\(asset.arch)/\(asset.kind)").inserted else { return .invalid("assets") }
            assets.append(asset)
        }
        return .ok(UpdateManifest(version: versionText, channel: channel, tag: "v\(versionText)", commit: commitText, releasedAt: releasedAt, notes: notes, assets: assets), version)
    }

    /// Nunca se ofrece una versión igual o inferior. `kinds` vacío: solo se avisa (iPhone).
    public static func evaluate(_ manifest: UpdateManifest, version: UpdateVersion, current: UpdateVersion, channel: UpdateChannel,
                                platform: String, arch: String, kinds: [String]) -> UpdateDecision {
        if version == current { return .upToDate }
        if version < current { return .rejected("older") }
        if channel == .stable && manifest.channel != .stable { return .rejected("channel") }
        if kinds.isEmpty { return .available(nil) }
        for kind in kinds {
            if let asset = manifest.assets.first(where: { $0.platform == platform && $0.kind == kind && ($0.arch == arch || $0.arch == "universal") }) {
                return .available(asset)
            }
        }
        return .rejected("no-asset")
    }

    private static let base64 = Pattern("^[A-Za-z0-9+/]+={0,2}$")

    /// ECDSA P-256 con SHA-256, firma DER en base64 (icarus-update.json.sig).
    public static func verifySignature(_ manifest: Data, signature: String, publicKeyPEM: String) -> Bool {
        let compact = signature.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !compact.isEmpty, compact.count <= maxSignatureBytes, base64.matches(compact), let der = Data(base64Encoded: compact) else { return false }
        #if canImport(CryptoKit)
        guard let key = try? P256.Signing.PublicKey(pemRepresentation: publicKeyPEM),
              let value = try? P256.Signing.ECDSASignature(derRepresentation: der)
        else { return false }
        return key.isValidSignature(value, for: manifest)
        #else
        return false
        #endif
    }

    public static func isValidPublicKey(_ pem: String) -> Bool {
        #if canImport(CryptoKit)
        return (try? P256.Signing.PublicKey(pemRepresentation: pem)) != nil
        #else
        return false
        #endif
    }
}

/// Comprobación sin credenciales en GitHub Releases. Las direcciones se construyen
/// aquí y las redirecciones solo pueden ir a hosts de GitHub.
public final class UpdateChecker: NSObject, URLSessionTaskDelegate {
    public enum CheckError: Error, Equatable {
        case network, rateLimited, notFound, signature, invalidManifest, noKey
    }

    private let repository: String
    private let allowedHosts: Set<String> = ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com", "api.github.com"]
    private lazy var session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil)

    public init(repository: String = "saaqes/icarus-browser") {
        self.repository = repository
    }

    public func releasePage(tag: String) -> URL { URL(string: "https://github.com/\(repository)/releases/tag/\(tag)")! }

    private func allowed(_ url: URL?) -> Bool {
        guard let url, url.scheme == "https", url.user == nil, url.password == nil, url.port == nil, let host = url.host else { return false }
        return allowedHosts.contains(host)
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                           newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(allowed(request.url) ? request : nil)
    }

    private func get(_ url: URL, limit: Int) async throws -> Data {
        guard allowed(url) else { throw CheckError.invalidManifest }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(from: url)
        } catch {
            throw CheckError.network
        }
        guard let http = response as? HTTPURLResponse, allowed(http.url) else { throw CheckError.invalidManifest }
        if http.statusCode == 404 { throw CheckError.notFound }
        if http.statusCode == 429 || (http.statusCode == 403 && http.value(forHTTPHeaderField: "X-RateLimit-Remaining") == "0") { throw CheckError.rateLimited }
        // Una redirección rechazada llega como 3xx: no es la respuesta pedida.
        guard (200..<300).contains(http.statusCode) else { throw CheckError.network }
        guard data.count <= limit else { throw CheckError.invalidManifest }
        return data
    }

    /// Manifiesto del canal verificado con la clave pública sobre los bytes exactos recibidos.
    public func fetch(channel: UpdateChannel, publicKeyPEM: String?) async throws -> (UpdateManifest, UpdateVersion) {
        guard let publicKeyPEM else { throw CheckError.noKey }
        let base = "https://github.com/\(repository)/releases"
        var expectedTag: String?
        let folder: String
        if channel == .stable {
            folder = "\(base)/latest/download"
        } else {
            let listData = try await get(URL(string: "https://api.github.com/repos/\(repository)/releases?per_page=30")!, limit: 2 * 1024 * 1024)
            guard let list = (try? JSONSerialization.jsonObject(with: listData)) as? [[String: Any]] else { throw CheckError.invalidManifest }
            expectedTag = Self.newestTag(list)
            guard let tag = expectedTag else { throw CheckError.notFound }
            folder = "\(base)/download/\(tag)"
        }
        let manifest = try await get(URL(string: "\(folder)/\(UpdateManifests.manifestFile)")!, limit: UpdateManifests.maxManifestBytes)
        let signature = try await get(URL(string: "\(folder)/\(UpdateManifests.signatureFile)")!, limit: UpdateManifests.maxSignatureBytes)
        guard UpdateManifests.verifySignature(manifest, signature: String(decoding: signature, as: UTF8.self), publicKeyPEM: publicKeyPEM) else { throw CheckError.signature }
        guard case .ok(let parsed, let version) = UpdateManifests.parse(String(decoding: manifest, as: UTF8.self)) else { throw CheckError.invalidManifest }
        if let expectedTag, parsed.tag != expectedTag { throw CheckError.invalidManifest }
        if channel == .stable && parsed.channel != .stable { throw CheckError.invalidManifest }
        return (parsed, version)
    }

    /// Etiqueta de la versión publicada más reciente con manifiesto y firma (sin borradores).
    static func newestTag(_ list: [[String: Any]]) -> String? {
        var best: (tag: String, version: UpdateVersion)?
        for release in list {
            guard release["draft"] as? Bool == false, let tag = release["tag_name"] as? String, tag.hasPrefix("v"),
                  let version = UpdateVersion.parse(String(tag.dropFirst())) else { continue }
            let names = (release["assets"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }
            guard names.contains(UpdateManifests.manifestFile), names.contains(UpdateManifests.signatureFile) else { continue }
            if best == nil || version > best!.version { best = (tag, version) }
        }
        return best?.tag
    }
}
