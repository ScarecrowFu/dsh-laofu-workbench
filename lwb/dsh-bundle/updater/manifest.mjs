/**
 * One LWB Desktop release, as ATS publishes it.
 *
 * The Host never trusts the transport: a release is accepted only after the
 * manifest it was told about is rebuilt in the exact field order the signer
 * used and verified against the product's Ed25519 public key. The signing key
 * lives in ATS (`DESKTOP_RELEASE_SIGNING_PRIVATE_KEY`); this module is the only
 * place the matching public key is trusted, so a manifest that arrives over a
 * hijacked connection, a compromised CDN, or a hand-edited OSS object is
 * rejected before a single byte is downloaded.
 *
 * Every other check here exists to keep a valid signature from authorising
 * something the signature was never meant to authorise: another product, the
 * other architecture, a downgrade, a file name that would escape the staging
 * directory, or an artifact larger than the installer can afford to write.
 */
import { createPublicKey, verify } from 'node:crypto'

export const RELEASE_SIGNING_PUBLIC_KEY_SPKI_BASE64 = 'MCowBQYDK2VwAyEAKH4F46tlYGBJWMmIXyZ1Vz9vd0src5V0tcx3njwvVIc='
export const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024 * 1024
export const SIGNATURE_ALGORITHM = 'ed25519'

/**
 * Artifact shapes this product can install.
 *
 * The extension is not the whole story any more: macOS and Windows both ship a
 * `.zip`, but they are different artifacts and only one of them belongs on a
 * given machine. `installer.mjs` therefore pairs each installation *method*
 * with the one type it accepts, and the extension check below only keeps a
 * mismatched file name from being staged.
 *
 * - `mac-app-zip`       the `.app` bundle, replaced in place.
 * - `launch-package-zip` launcher plus an archive of the unpacked Windows app;
 *   the launcher installs it into a versioned directory and switches to it.
 */
export const UPDATE_ARTIFACT_TYPES = Object.freeze({
  'mac-app-zip': '.zip',
  'launch-package-zip': '.zip',
})

/** Text field that must be a non-empty string, or the empty string. */
function stringValue(value) {
  return typeof value === 'string' ? value : ''
}

function nullableString(value) {
  return value === null || typeof value === 'string' ? value : null
}

/**
 * Read a manifest into the shape the signer signed.
 *
 * Absent fields become the empty string rather than `undefined`, so a manifest
 * missing a key still canonicalises to *something* and fails the signature
 * check instead of silently dropping out of the JSON.
 * @param value - `manifest` field of an ATS `latest` response.
 * @returns the parsed manifest.
 */
export function parseManifest(value) {
  if (!value || typeof value !== 'object') throw new Error('更新服务返回的发布清单无效。')
  const source = value
  if (source.schemaVersion !== 1) throw new Error('不支持的更新清单版本。')
  return {
    schemaVersion: 1,
    product: stringValue(source.product),
    version: stringValue(source.version),
    platform: stringValue(source.platform),
    arch: stringValue(source.arch),
    channel: stringValue(source.channel),
    artifactType: stringValue(source.artifactType),
    fileName: stringValue(source.fileName),
    releaseNotes: stringValue(source.releaseNotes),
    downloadUrl: stringValue(source.downloadUrl),
    sha256: stringValue(source.sha256).toLowerCase(),
    sizeBytes: stringValue(source.sizeBytes),
    mandatory: source.mandatory === true,
    minVersion: nullableString(source.minVersion),
    minLauncherVersion: nullableString(source.minLauncherVersion),
    rolloutPercent: Number(source.rolloutPercent),
  }
}

/**
 * @param signature - `signature` field of an ATS `latest` response.
 * @param algorithm - `signatureAlgorithm` field of the same response.
 * @returns the base64 signature.
 */
export function parseSignature(signature, algorithm) {
  if (algorithm !== SIGNATURE_ALGORITHM || typeof signature !== 'string' || !signature.trim()) {
    throw new Error('更新服务返回的签名无效。')
  }
  return signature.trim()
}

/**
 * The exact bytes that were signed.
 *
 * ATS signs `JSON.stringify` of its own record, whose columns are fixed by the
 * database schema. Field order therefore carries meaning: reordering or
 * reformatting here would invalidate every signature the server produces.
 * @param manifest - parsed manifest.
 * @returns the canonical JSON string.
 */
export function canonicalizeManifest(manifest) {
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    product: manifest.product,
    version: manifest.version,
    platform: manifest.platform,
    arch: manifest.arch,
    channel: manifest.channel,
    artifactType: manifest.artifactType,
    fileName: manifest.fileName,
    releaseNotes: manifest.releaseNotes,
    downloadUrl: manifest.downloadUrl,
    sha256: manifest.sha256,
    sizeBytes: manifest.sizeBytes,
    mandatory: manifest.mandatory,
    minVersion: manifest.minVersion,
    minLauncherVersion: manifest.minLauncherVersion,
    rolloutPercent: manifest.rolloutPercent,
  })
}

/** Whether a release of this shape can be installed by replacing this bundle. */
export function artifactExtension(artifactType) {
  return UPDATE_ARTIFACT_TYPES[artifactType]
}

/**
 * Accept one release only when it is this product, this target, newer, and
 * correctly signed.
 * @param manifest - parsed manifest.
 * @param signature - base64 signature over the canonical manifest.
 * @param expected - what this installation is.
 * @param expected.product - ATS product slug.
 * @param expected.platform - `process.platform` of this install.
 * @param expected.arch - `process.arch` of this install.
 * @param expected.channel - release channel of this install.
 * @param expected.currentVersion - version already installed.
 * @param options - verification inputs.
 * @param options.publicKey - SPKI base64 key to trust instead of the shipped one.
 *   Only tests and a future key rotation pass this; the shipped constant is the
 *   key every user's installation actually trusts.
 * @returns the manifest, so callers can chain.
 */
export function validateRelease(manifest, signature, expected, options = {}) {
  if (manifest.product !== expected.product || manifest.platform !== expected.platform || manifest.arch !== expected.arch) {
    throw new Error('更新包与当前产品或系统架构不匹配。')
  }
  if (manifest.channel !== expected.channel) throw new Error('更新包发布通道不匹配。')
  const extension = artifactExtension(manifest.artifactType)
  if (!extension) throw new Error('更新包发布类型不匹配。')
  if (!isSemver(manifest.version) || compareVersions(manifest.version, expected.currentVersion) <= 0) {
    throw new Error('更新包版本无效。')
  }
  if (!/^[a-f0-9]{64}$/u.test(manifest.sha256) || !isSafeFileName(manifest.fileName)) {
    throw new Error('更新包文件信息无效。')
  }
  if (!manifest.fileName.toLowerCase().endsWith(extension)) {
    throw new Error(`更新包文件名与发布类型不符，应以 ${extension} 结尾。`)
  }
  const size = Number(manifest.sizeBytes)
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_ARTIFACT_BYTES) {
    throw new Error('更新包大小超出限制。')
  }
  if (!Number.isInteger(manifest.rolloutPercent) || manifest.rolloutPercent < 0 || manifest.rolloutPercent > 100) {
    throw new Error('更新包灰度信息无效。')
  }
  const downloadUrl = new URL(manifest.downloadUrl)
  if (downloadUrl.protocol !== 'https:') throw new Error('更新包下载地址必须使用 HTTPS。')
  const signatureBytes = Buffer.from(signature, 'base64')
  if (!signatureBytes.length) throw new Error('更新包签名无效。')
  const publicKey = createPublicKey({
    key: Buffer.from(options.publicKey ?? RELEASE_SIGNING_PUBLIC_KEY_SPKI_BASE64, 'base64'),
    format: 'der',
    type: 'spki',
  })
  if (!verify(null, Buffer.from(canonicalizeManifest(manifest), 'utf8'), publicKey, signatureBytes)) {
    throw new Error('更新包签名校验失败。')
  }
  return manifest
}

/** What the sidebar shows: nothing here is larger than a sentence. */
export function releaseSummary(manifest) {
  return {
    version: manifest.version,
    releaseNotes: manifest.releaseNotes,
    mandatory: manifest.mandatory,
    sizeBytes: manifest.sizeBytes,
  }
}

export function isSemver(value) {
  return /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(value)
}

/**
 * Whether a name can be used as a file inside one staging directory.
 *
 * The name comes from the server, so it must not be able to point outside the
 * directory the artifact is written to.
 */
export function isSafeFileName(value) {
  return Boolean(value) && value.length <= 255 && !/[\\/]/u.test(value) && value !== '.' && value !== '..'
}

export function normalizeChannel(value) {
  const channel = String(value || '').trim().toLowerCase()
  return ['stable', 'beta', 'internal'].includes(channel) ? channel : 'stable'
}

/**
 * Semver comparison with prerelease ordering, matching what ATS publishes.
 * @returns negative when `left` is older, positive when newer, zero when equal.
 */
export function compareVersions(left, right) {
  const parse = (value) => {
    const match = String(value).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u)
    if (!match) throw new Error('版本号必须使用语义化版本格式。')
    return { numbers: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4]?.split('.') ?? [] }
  }
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const aPart = a.prerelease[index]
    const bPart = b.prerelease[index]
    if (aPart === undefined) return -1
    if (bPart === undefined) return 1
    if (aPart === bPart) continue
    const aNumeric = /^\d+$/u.test(aPart)
    const bNumeric = /^\d+$/u.test(bPart)
    if (aNumeric && bNumeric) return Number(aPart) > Number(bPart) ? 1 : -1
    if (aNumeric) return -1
    if (bNumeric) return 1
    return aPart > bPart ? 1 : -1
  }
  return 0
}
