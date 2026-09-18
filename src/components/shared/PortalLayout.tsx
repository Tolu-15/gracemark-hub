"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "@/lib/auth";
import PoweredBy from "./PoweredBy";

export interface NavItem {
  label: string;
  href: string;
  icon?: React.ReactNode;
  badge?: string;
  category?: string;
}

interface PortalLayoutProps {
  role: "admin" | "teacher" | "student";
  title?: string;
  subtitle?: React.ReactNode;
  headerActions?: React.ReactNode;
  navItems: NavItem[];
  children: React.ReactNode;
}

export default function PortalLayout({
  role,
  title,
  subtitle,
  headerActions,
  navItems,
  children,
}: PortalLayoutProps) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // Close mobile nav on route change
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // Close on Escape key and handle resize
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setNavOpen(false);
    }
    function handleResize() {
      if (window.innerWidth >= 768) setNavOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  async function handleSignOut() {
    try {
      await signOut();
      router.replace("/");
    } catch (err) {
      console.error("Sign out error:", err);
      router.replace("/");
    }
  }

  // Group nav items by category
  const categories: { name?: string; items: NavItem[] }[] = [];
  navItems.forEach((item) => {
    const lastCat = categories[categories.length - 1];
    if (!lastCat || lastCat.name !== item.category) {
      categories.push({ name: item.category, items: [item] });
    } else {
      lastCat.items.push(item);
    }
  });

  return (
    <div
      className={`portal-app flex h-screen h-[100dvh] overflow-hidden bg-slate-50 text-slate-800 ${
        navOpen ? "portal-nav-open" : ""
      }`}
    >
      {/* Mobile Drawer Backdrop */}
      <div
        id="portalNavBackdrop"
        className="portal-nav-backdrop"
        hidden={!navOpen}
        style={{ display: navOpen ? "block" : "none" }}
        onClick={() => setNavOpen(false)}
      />

      {/* Sidebar Navigation */}
      <aside
        id="portalSidebar"
        className="portal-sidebar w-64 bg-slate-950 text-slate-300 flex flex-col shrink-0"
      >
        <div className="p-6 border-b border-slate-800 flex items-center justify-between gap-2">
          <div className="portal-sidebar-brand flex items-center gap-3 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/assets/icons/logo.jpg"
              alt="Gracemark Logo"
              className="w-9 h-9 rounded-lg object-cover shadow-sm flex-shrink-0"
            />
            <h2 className="text-lg font-bold text-white tracking-tight">
              Gracemark{" "}
              {role === "admin" && (
                <span className="text-xs text-yellow-500 align-top">V2</span>
              )}
              {role === "teacher" && (
                <span className="text-xs text-blue-400 align-top">Teacher</span>
              )}
              {role === "student" && (
                <span className="text-xs text-emerald-400 align-top">Student</span>
              )}
            </h2>
          </div>
          <button
            type="button"
            id="portalMenuClose"
            className="portal-sidebar-close md:hidden"
            aria-label="Close navigation menu"
            onClick={() => setNavOpen(false)}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto text-sm font-medium">
          {categories.map((cat, idx) => (
            <React.Fragment key={idx}>
              {cat.name && (
                <div className="pt-3 pb-1 text-[10px] font-bold uppercase text-slate-500 px-3 tracking-wider">
                  {cat.name}
                </div>
              )}
              {cat.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/admin/dashboard" &&
                    item.href !== "/teacher/dashboard" &&
                    item.href !== "/student/dashboard" &&
                    pathname.startsWith(item.href));

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                      isActive
                        ? "bg-slate-800 text-white font-semibold"
                        : "text-slate-300 hover:bg-slate-800/50 hover:text-white"
                    }`}
                  >
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                    {item.badge && (
                      <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </React.Fragment>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button
            id="logoutBtn"
            type="button"
            onClick={handleSignOut}
            className="flex items-center gap-3 w-full px-3 py-2.5 text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="portal-main flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto">
        {(title || headerActions) && (
          <header className="portal-header bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20 shrink-0">
            <div className="portal-header-start flex items-center gap-3">
              <button
                type="button"
                id="portalMenuBtn"
                className="portal-menu-btn md:hidden"
                aria-label="Open navigation menu"
                aria-expanded={navOpen}
                aria-controls="portalSidebar"
                onClick={() => setNavOpen(true)}
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </button>
              <div className="portal-header-title min-w-0">
                {title && (
                  <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight truncate">
                    {title}
                  </h1>
                )}
                {subtitle && <div className="text-sm text-slate-500 mt-0.5">{subtitle}</div>}
              </div>
            </div>
            {headerActions && (
              <div className="portal-header-actions flex items-center gap-2">
                {headerActions}
              </div>
            )}
          </header>
        )}

        <div className="portal-content flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </div>

        <PoweredBy />
      </main>
    </div>
  );
}
