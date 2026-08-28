/**
 * Partner auth session isolation — routing + source checks.
 * Run: node scripts/test-partner-auth-session-isolation.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  resolvePartnerAuthView,
  hasMappedPub,
  shouldExpirePartnerShiftOnSession
} = require("../partner-auth-view.js");

const userA = { id: "user-a" };
const userB = { id: "user-b" };
const pubA = { pub_id: 6, pub_name: "Pintdrop test pub" };

assert.strictEqual(hasMappedPub(null), false);
assert.strictEqual(hasMappedPub({}), false);
assert.strictEqual(hasMappedPub({ pub_id: 0 }), false);
assert.strictEqual(hasMappedPub({ pub_id: 6 }), true);

assert.strictEqual(
  resolvePartnerAuthView({ session: null }),
  "login",
  "No session → login"
);

assert.strictEqual(
  resolvePartnerAuthView({
    session: null,
    pendingConfirmEmail: "new@example.com"
  }),
  "confirmEmail",
  "Signup completed, confirmation required → confirmation screen"
);

assert.strictEqual(
  resolvePartnerAuthView({
    session: { user: userB },
    emailConfirmed: false,
    profile: pubA,
    profileOwnerUserId: userA.id,
    unconfirmedLogin: true
  }),
  "confirmEmail",
  "Unconfirmed user cannot render a pub dashboard"
);

assert.strictEqual(
  resolvePartnerAuthView({
    session: { user: userB },
    emailConfirmed: true,
    profile: null
  }),
  "register",
  "Confirmed unmapped user → new-pub registration"
);

assert.strictEqual(
  resolvePartnerAuthView({
    session: { user: userA },
    emailConfirmed: true,
    profile: pubA,
    profileOwnerUserId: userA.id
  }),
  "dashboard",
  "Confirmed mapped user → their own pub dashboard"
);

assert.strictEqual(
  resolvePartnerAuthView({
    session: { user: userB },
    emailConfirmed: true,
    profile: pubA,
    profileOwnerUserId: userA.id
  }),
  "login",
  "User B must not receive User A's mapped pub"
);

assert.strictEqual(
  resolvePartnerAuthView({
    session: { user: userA },
    emailConfirmed: true,
    profile: pubA,
    profileOwnerUserId: userA.id,
    profileLoadError: true
  }),
  "login",
  "Profile/RPC load error must not keep a dashboard"
);

assert.strictEqual(
  resolvePartnerAuthView({
    session: null,
    forcedScreen: "signup",
    profile: pubA
  }),
  "signup",
  "Opening Create account with no session shows signup, not cached pub"
);

assert.strictEqual(
  resolvePartnerAuthView({
    session: null,
    unconfirmedLogin: true,
    pendingConfirmEmail: "b@example.com",
    profile: pubA
  }),
  "confirmEmail",
  "Failed unconfirmed login as B cannot display A's dashboard"
);

assert.strictEqual(
  shouldExpirePartnerShiftOnSession({
    session: { user: userA },
    authAttemptInProgress: true,
    shiftExpired: true
  }),
  false,
  "Confirmed mapped login after previous-session cleanup must not signOut on missing shift"
);

assert.strictEqual(
  shouldExpirePartnerShiftOnSession({
    session: { user: userA },
    authAttemptInProgress: false,
    shiftExpired: true
  }),
  true,
  "Expired shift still logs out when no login is in progress"
);

assert.strictEqual(
  resolvePartnerAuthView({
    session: { user: userA },
    emailConfirmed: true,
    profile: pubA,
    profileOwnerUserId: userA.id
  }),
  "dashboard",
  "After cleanup, confirmed mapped user still reaches only their own dashboard"
);

const appJs = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const configJs = fs.readFileSync(path.join(__dirname, "../supabase-config.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");

function mustInclude(source, snippet, label) {
  assert.ok(source.includes(snippet), label);
}

mustInclude(appJs, "preparePartnerAuthAttempt", "Login/signup clears previous partner session");
mustInclude(appJs, "resetPartnerDashboardDom", "Dashboard DOM is cleared on auth transitions");
mustInclude(appJs, "partnerProfileOwnerUserId === sessionUserId", "Dashboard requires profile to belong to current user");
mustInclude(appJs, "isPartnerEmailConfirmed()", "Dashboard requires confirmed email");
mustInclude(appJs, "await preparePartnerAuthAttempt({ forcedScreen: \"login\" })", "Failed/new login starts by clearing prior auth");
mustInclude(appJs, "isEmailNotConfirmedError", "Unconfirmed login is detected");
mustInclude(appJs, "unconfirmedLogin: true", "Unconfirmed login shows confirmation, not dashboard");
mustInclude(appJs, "handlePartnerResendConfirmationEmail", "Resend confirmation email handler exists");
mustInclude(appJs, "Do not localStorage.clear() or delete invite/claim tokens", "Invite tokens are not casually deleted");
mustInclude(appJs, "resetPartnerDashboardDom();", "Logout/auth transitions clear dashboard DOM");
mustInclude(appJs, "handlePartnerLogout", "Logout handler exists");
assert.ok(
  /async function handlePartnerLogout\(\) \{\s*resetPartnerDashboardDom\(\);\s*setPartnerPanelVisibility\(\{ login: true \}\);/.test(appJs),
  "Logout hides dashboard immediately"
);

assert.ok(
  !appJs.replace(/\/\/[^\n]*/g, "").includes("localStorage.clear("),
  "Must not wipe all localStorage (invite tokens)"
);
assert.ok(
  !appJs.includes('localStorage.removeItem("pintdrop_partner_invite')
    && !appJs.includes("localStorage.removeItem('pintdrop_partner_invite"),
  "Must not delete partner invite storage keys"
);
assert.ok(
  !appJs.includes("partnerProfile?.pub_id\n    ? \"logged_in\""),
  "Must not short-circuit dashboard from a stale pub_id"
);

mustInclude(configJs, "resendConfirmationEmail: resendPartnerConfirmationEmail", "PartnerAuth exposes resend");
mustInclude(configJs, 'type: "signup"', "Resend uses signup confirmation");
mustInclude(configJs, "getPartnerAuthRedirectTo", "Confirmation redirect uses current origin + ?view=partner");
mustInclude(configJs, "throw new Error(error.message || \"Could not load partner profile.\")", "Profile RPC errors are not treated as empty mapping");

mustInclude(indexHtml, "partner-auth-view.js", "Routing helper is loaded before app.js");
mustInclude(indexHtml, "partnerConfirmEmailResendBtn", "Resend confirmation button exists");
mustInclude(indexHtml, "20260827-partner-auth-isolation", "Cache-bust updated for partner auth isolation");
mustInclude(appJs, "finishPartnerAuthAttempt();", "Auth attempts always finish and reset loading state");
mustInclude(appJs, "resetPartnerLoginButton(submitBtn);", "Login button leaves Signing in on success or failure");
assert.ok(
  /if \(partnerAuthAttemptDepth > 0\) \{\r?\n\s*return;/.test(appJs),
  "onAuthStateChange does not run during login cleanup"
);
mustInclude(appJs, "shouldExpirePartnerShiftOnSession", "Login does not expire shift while an auth attempt is in progress");
mustInclude(appJs, "withPartnerAuthTimeout", "Stalled auth requests have a timeout");
mustInclude(appJs, "PARTNER_AUTH_STALL_MESSAGE", "Stalled auth shows a retry message");

console.log("partner auth session isolation tests passed");
