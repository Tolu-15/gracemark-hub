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
        className={`portal-nav-backdrop fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-xs transition-opacity duration-200 ${
          navOpen ? "block opacity-100" : "hidden opacity-0 pointer-events-none"
        }`}
        onClick={() => setNavOpen(false)}
      />

      {/* Sidebar Navigation */}
      <aside
        id="portalSidebar"
        className={`portal-sidebar fixed md:static inset-y-0 left-0 z-50 w-72 md:w-64 bg-slate-950 text-slate-300 flex flex-col shrink-0 transition-transform duration-200 ease-in-out ${
          navOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="p-5 sm:p-6 border-b border-slate-800 flex items-center justify-between gap-2">
          <div className="portal-sidebar-brand flex items-center gap-3 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/assets/icons/logo.jpg"
              alt="Gracemark Logo"
              className="w-9 h-9 rounded-xl object-cover shadow-sm flex-shrink-0"
            />
            <div className="min-w-0">
              <h2 className="text-base font-bold text-white tracking-tight leading-none">
                Gracemark
              </h2>
              <p className="text-[10px] font-semibold text-slate-400 mt-1 uppercase tracking-wider">
                {role === "admin" && "Admin Portal V2"}
                {role === "teacher" && "Teacher Portal"}
                {role === "student" && "Student Portal"}
              </p>
            </div>
          </div>
          <button
            type="button"
            id="portalMenuClose"
            className="md:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
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
                    onClick={() => setNavOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                      isActive
                        ? "bg-slate-800 text-white font-semibold shadow-xs"
                        : "text-slate-300 hover:bg-slate-800/50 hover:text-white"
                    }`}
                  >
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                    {item.badge && (
                      <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-bold">
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
            className="flex items-center gap-3 w-full px-3 py-2.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800/50 rounded-xl transition-colors cursor-pointer text-xs font-semibold"
          >
            <svg
              className="w-4 h-4"
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
        {/* Mobile Header Bar - Always visible on small screens (< md) */}
        <div className="md:hidden sticky top-0 z-30 flex items-center justify-between px-3.5 py-2.5 bg-slate-950 border-b border-slate-800 text-white shrink-0 shadow-md">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              id="portalMobileHamburgerBtn"
              onClick={() => setNavOpen(true)}
              aria-label="Open navigation menu"
              className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-white transition border border-slate-800 shrink-0 cursor-pointer active:scale-95"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <img
                src="/assets/icons/logo.jpg"
                alt="Gracemark Logo"
                className="w-7 h-7 rounded-lg object-cover shrink-0 shadow-xs"
              />
              <span className="font-bold text-sm tracking-tight text-white truncate">
                Gracemark
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider shrink-0 ${
                  role === "admin"
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                    : role === "teacher"
                    ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                    : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                }`}
              >
                {role}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-900 rounded-xl transition text-xs flex items-center gap-1 cursor-pointer shrink-0"
            title="Sign Out"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>

        {/* Desktop / Page-Specific Header */}
        {(title || headerActions) && (
          <header className="portal-header hidden md:flex bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 items-center justify-between gap-3 sticky top-0 z-20 shrink-0">
            <div className="portal-header-start flex items-center gap-3">
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

        <div className="portal-content flex-1 p-3.5 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </div>

        <PoweredBy />
      </main>
    </div>
  );
}
