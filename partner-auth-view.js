/**
 * Pure partner-auth screen routing. Loaded before app.js.
 * NULL pub mapping and missing session must never reuse another pub's dashboard.
 */
(function (root) {
  function hasMappedPub(profile) {
    const pubId = Number(profile && profile.pub_id);
    return Boolean(profile && Number.isFinite(pubId) && pubId > 0);
  }

  function resolvePartnerAuthView(input) {
    const session = input && input.session;
    const emailConfirmed = Boolean(input && input.emailConfirmed);
    const profile = input && input.profile;
    const profileOwnerUserId = input && input.profileOwnerUserId;
    const pendingConfirmEmail = String((input && input.pendingConfirmEmail) || "").trim();
    const unconfirmedLogin = Boolean(input && input.unconfirmedLogin);
    const profileLoadError = Boolean(input && input.profileLoadError);
    const forcedScreen = input && input.forcedScreen;
    const sessionUserId = session && session.user && session.user.id;

    if (forcedScreen === "signup" && !session) {
      return "signup";
    }

    if (!session) {
      if (unconfirmedLogin || pendingConfirmEmail) return "confirmEmail";
      return "login";
    }

    if (!emailConfirmed) {
      return "confirmEmail";
    }

    if (profileLoadError) {
      return "login";
    }

    if (!hasMappedPub(profile)) {
      return "register";
    }

    if (profileOwnerUserId && sessionUserId && profileOwnerUserId !== sessionUserId) {
      return "login";
    }

    return "dashboard";
  }

  /**
   * A missing/expired shift must log the user out on page load,
   * but never during an in-progress login/signup (shift is cleared on purpose).
   */
  function shouldExpirePartnerShiftOnSession(input) {
    if (!input || !input.session) return false;
    if (input.authAttemptInProgress) return false;
    return input.shiftExpired === true;
  }

  const api = { resolvePartnerAuthView, hasMappedPub, shouldExpirePartnerShiftOnSession };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.PintDropPartnerAuthView = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
