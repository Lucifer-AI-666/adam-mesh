export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * Generate login URL at runtime.
 * Encodes the current page path into state so the OAuth callback
 * can redirect the user back to where they were — zero friction.
 */
export const getLoginUrl = (returnPath?: string) => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  if (!oauthPortalUrl) return "/";
  const redirectUri = `${window.location.origin}/api/oauth/callback`;

  // Encode both redirectUri and returnPath in state
  const statePayload = JSON.stringify({
    redirectUri,
    returnPath: returnPath || window.location.pathname,
  });
  const state = btoa(statePayload);

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};
