/**
 * @bacons/apple-targets configuration for the OpenFlow iOS keyboard extension.
 *
 * The `keyboard` type maps to NSExtensionPointIdentifier `com.apple.keyboard-service`
 * and a principal class `$(PRODUCT_MODULE_NAME).KeyboardViewController` — so the
 * Swift entry-point class MUST be named `KeyboardViewController` (see
 * KeyboardViewController.swift).
 *
 * The target's `Info.plist` is authored by hand (see ./Info.plist) so we can set
 * `RequestsOpenAccess = YES` (required for App Group access / the hand-off). The
 * plugin only writes a default Info.plist when one is absent, so ours is respected.
 *
 * appleTeamId is intentionally omitted (no Apple account yet). The plugin only
 * WARNS when it is missing — prebuild + a CODE_SIGNING_ALLOWED=NO simulator build
 * still succeed. Set it in app.config.ts (ios.appleTeamId, wired from
 * process.env.APPLE_TEAM_ID) once an account exists.
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: 'keyboard',
  name: 'keyboard',
  displayName: 'OpenFlow Keyboard',
  // FINAL id (see docs/ARCHITECTURE.md). Store ids are permanent.
  bundleIdentifier: 'computer.openflow.mobile.keyboard',
  deploymentTarget: '16.0',
  // Shared App Group carries the non-secret settings + the dictation hand-off
  // payload written by the container app and read here. Mirrored on the main app
  // in app.config.ts (ios.entitlements).
  entitlements: {
    'com.apple.security.application-groups': ['group.computer.openflow.mobile'],
  },
};
