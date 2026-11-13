export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/** Login page URL; the current path is passed as `next` so the user returns to it after signing in. */
export const getLoginUrl = (returnPath?: string) => {
  const next = returnPath || window.location.pathname;
  return next && next !== "/login" ? `/login?next=${encodeURIComponent(next)}` : "/login";
};
