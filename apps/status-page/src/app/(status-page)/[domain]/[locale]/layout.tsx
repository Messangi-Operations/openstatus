import { pageConfigurationSchema } from "@openstatus/db/src/schema";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { DateFnsProvider } from "../../../../components/date-fns-provider";
import { StatusBlocksProvider } from "../../../../components/i18n/status-blocks-provider";
import { routing } from "../../../../i18n/routing";
import { getQueryClient, trpc } from "../../../../lib/trpc/server";

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  // `domain` is always the page SLUG — applyPageSlugPrefix rewrites custom
  // domains to it before routing.
  params: Promise<{ locale: string; domain: string }>;
}) {
  const { locale, domain } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const messages = (await import(`../../../../../messages/${locale}.json`))
    .default;

  // Resolve the page's display zone HERE, on the server, and hand it to the
  // provider as a prop. The provider is a client component, so reading config
  // inside it would compute one value during SSR and another after hydration —
  // the exact mismatch a fixed per-page zone exists to avoid. A prop serializes
  // into the RSC payload, so both passes see the same string by construction.
  //
  // safeParse + fallback mirrors the parent layout: a stale or invalid value in
  // stored config must not crash the page (the schema's `.catch` already
  // degrades `timezone` to UTC, this guards the rest).
  const page = await getQueryClient().fetchQuery(
    trpc.statusPage.get.queryOptions({ slug: domain }),
  );
  const cfg = pageConfigurationSchema.safeParse(page?.configuration ?? {});
  const timeZone = cfg.success ? cfg.data.timezone : "UTC";

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <DateFnsProvider locale={locale}>
        <StatusBlocksProvider timeZone={timeZone}>
          {children}
        </StatusBlocksProvider>
      </DateFnsProvider>
    </NextIntlClientProvider>
  );
}
