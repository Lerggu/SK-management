"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Building2, Check, ChevronsUpDown, LogOut, Menu } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/ui/components/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/ui/components/sheet";
import { cn } from "@/ui/lib/utils";
import { NAV_ICONS, type NavKey } from "./nav-icons";

export interface ShellNavItem {
  key: NavKey;
  href: string;
  label: string;
}

export interface ShellProps {
  company: { name: string; slug: string };
  companies: { name: string; slug: string }[];
  user: { name: string | null; email: string };
  nav: ShellNavItem[];
  locale: "fi" | "en";
  labels: {
    appName: string;
    mainNav: string;
    more: string;
    switchCompany: string;
    allCompanies: string;
    signOut: string;
    language: string;
    fi: string;
    en: string;
  };
  signOutAction: () => Promise<void>;
  setLocaleAction: (formData: FormData) => Promise<void>;
  children: React.ReactNode;
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function CompanySwitcher({ company, companies, labels, className, dark }: Pick<ShellProps, "company" | "companies" | "labels"> & { className?: string; dark?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 text-left text-sm font-medium md:min-h-9",
          dark ? "border-white/20 bg-white/5 text-white hover:bg-white/10" : "bg-background hover:bg-muted",
          className,
        )}
        aria-label={labels.switchCompany}
        data-testid="company-switcher"
      >
        <Building2 className={cn("size-4 shrink-0", dark ? "text-white/70" : "text-muted-foreground")} aria-hidden />
        <span className="flex-1 truncate">{company.name}</span>
        <ChevronsUpDown className={cn("size-4 shrink-0", dark ? "text-white/70" : "text-muted-foreground")} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{labels.switchCompany}</DropdownMenuLabel>
        {companies.map((c) => (
          <DropdownMenuItem key={c.slug} asChild className="min-h-11 md:min-h-8">
            <Link href={`/c/${c.slug}/dashboard`}>
              <span className="flex-1 truncate">{c.name}</span>
              {c.slug === company.slug && <Check className="size-4" aria-hidden />}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="min-h-11 md:min-h-8">
          <Link href="/c">{labels.allCompanies}</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LocaleForm({ locale, labels, setLocaleAction, onSubmit, dark }: Pick<ShellProps, "locale" | "labels" | "setLocaleAction"> & { onSubmit?: () => void; dark?: boolean }) {
  return (
    <form action={setLocaleAction} onSubmit={onSubmit} className="flex items-center gap-1" aria-label={labels.language}>
      {(["fi", "en"] as const).map((l) => (
        <button
          key={l}
          type="submit"
          name="locale"
          value={l}
          aria-pressed={locale === l}
          className={cn(
            "min-h-11 rounded-md px-3 text-sm md:min-h-8",
            locale === l ? "bg-primary text-primary-foreground" : dark ? "text-white/75 hover:bg-white/10 hover:text-white" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {labels[l]}
        </button>
      ))}
    </form>
  );
}

function SignOutButton({ labels, signOutAction, dark }: Pick<ShellProps, "labels" | "signOutAction"> & { dark?: boolean }) {
  return (
    <form action={signOutAction}>
      <button type="submit" className={cn(
          "flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm md:min-h-9",
          dark ? "text-white/75 hover:bg-white/10 hover:text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}>
        <LogOut className="size-4" aria-hidden />
        {labels.signOut}
      </button>
    </form>
  );
}

export function AppShell(props: ShellProps) {
  const { company, companies, user, nav, labels, children } = props;
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  // Phones: the first four destinations in the bottom bar, the rest under "More".
  const primary = nav.slice(0, 4);
  const overflow = nav.slice(4);

  return (
    <div className="min-h-dvh bg-muted/30">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex flex-col gap-1 px-4 pt-5 pb-4">
          <Image src="/brand/sk-infra-logo-light.svg" alt="SK Infra" width={172} height={40} priority unoptimized className="h-10 w-auto self-start" />
          <span className="text-xs font-medium uppercase tracking-[0.2em] text-white/70">{labels.appName}</span>
        </div>
        <div className="px-3 pb-3">
          <CompanySwitcher company={company} companies={companies} labels={labels} dark />
        </div>
        <nav aria-label={labels.mainNav} className="flex-1 space-y-1 overflow-y-auto px-3">
          {nav.map((item) => {
            const Icon = NAV_ICONS[item.key];
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--brand-turquoise)]"
                    : "text-white/75 hover:bg-white/10 hover:text-white",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-2 border-t border-sidebar-border p-3">
          <div className="px-3 text-sm">
            <div className="truncate font-medium">{user.name ?? user.email}</div>
            <div className="truncate text-xs text-white/70">{user.email}</div>
          </div>
          <LocaleForm locale={props.locale} labels={labels} setLocaleAction={props.setLocaleAction} dark />
          <SignOutButton labels={labels} signOutAction={props.signOutAction} dark />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 bg-sidebar px-3 text-sidebar-foreground md:hidden">
        <Image src="/brand/sk-infra-mark.svg" alt={labels.appName} width={32} height={32} priority unoptimized className="size-8 shrink-0 rounded-sm" />
        <CompanySwitcher company={company} companies={companies} labels={labels} className="border-0 bg-transparent px-2" dark />
      </header>

      <main className="pb-24 md:pb-10 md:pl-64">
        <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-8 md:py-8">{children}</div>
      </main>

      {/* Mobile bottom navigation: large touch targets */}
      <nav aria-label={labels.mainNav} className="fixed inset-x-0 bottom-0 z-30 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden" data-testid="mobile-nav">
        <ul className="grid grid-cols-5">
          {primary.map((item) => {
            const Icon = NAV_ICONS[item.key];
            const active = isActive(pathname, item.href);
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                    active ? "text-primary shadow-[inset_0_3px_0_var(--brand-turquoise)]" : "text-muted-foreground",
                  )}
                >
                  <Icon className={cn("size-6", active && "stroke-[2.5]")} aria-hidden />
                  <span className="max-w-full truncate px-1">{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li className={cn(primary.length < 4 && "col-start-5")}>
            <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
              <SheetTrigger className="flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground" data-testid="mobile-more">
                <Menu className="size-6" aria-hidden />
                {labels.more}
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl">
                <SheetHeader>
                  <SheetTitle>{labels.more}</SheetTitle>
                </SheetHeader>
                <div className="space-y-4 px-4 pb-6">
                  {overflow.length > 0 && (
                    <ul className="space-y-1">
                      {overflow.map((item) => {
                        const Icon = NAV_ICONS[item.key];
                        return (
                          <li key={item.key}>
                            <Link href={item.href} onClick={() => setMoreOpen(false)} className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-base hover:bg-muted">
                              <Icon className="size-5" aria-hidden />
                              {item.label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div>
                    <p className="mb-1 px-1 text-xs font-medium uppercase text-muted-foreground">{labels.switchCompany}</p>
                    <ul className="space-y-1">
                      {companies.map((c) => (
                        <li key={c.slug}>
                          <Link
                            href={`/c/${c.slug}/dashboard`}
                            onClick={() => setMoreOpen(false)}
                            className={cn("flex min-h-12 items-center gap-3 rounded-lg px-3 text-base hover:bg-muted", c.slug === company.slug && "font-semibold")}
                          >
                            <Building2 className="size-5" aria-hidden />
                            <span className="flex-1">{c.name}</span>
                            {c.slug === company.slug && <Check className="size-5" aria-hidden />}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t pt-4">
                    <span className="text-sm text-muted-foreground">{labels.language}</span>
                    <LocaleForm locale={props.locale} labels={labels} setLocaleAction={props.setLocaleAction} onSubmit={() => setMoreOpen(false)} />
                  </div>
                  <div className="border-t pt-2">
                    <div className="px-3 py-2 text-sm">
                      <div className="font-medium">{user.name ?? user.email}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </div>
                    <SignOutButton labels={labels} signOutAction={props.signOutAction} />
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </li>
        </ul>
      </nav>
    </div>
  );
}
