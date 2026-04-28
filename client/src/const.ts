export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Simple local auth - redirect to login page (no OAuth)
export const getLoginUrl = (_returnPath?: string) => {
  return "/auth";
};
