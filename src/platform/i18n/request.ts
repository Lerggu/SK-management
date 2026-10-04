import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DISPLAY_TIME_ZONE, LOCALE_COOKIE, toLocale } from "./config";

/** next-intl request config: locale from cookie (default fi), Helsinki time zone. */
export default getRequestConfig(async () => {
  const locale = toLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const messages = (await import(`./messages/${locale}.json`)).default;
  return { locale, messages, timeZone: DISPLAY_TIME_ZONE, now: new Date() };
});
