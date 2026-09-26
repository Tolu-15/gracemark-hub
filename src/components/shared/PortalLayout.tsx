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
  /** Greyed out and not clickable; shows "Not available". */
  disabled?: boolean;
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

  // Highlight only the closest nav item (e.g. /admin/subjects/lists highlights
  // "Class Subject Lists", not also "Manage Subjects").
  const activeHref =
    navItems
      .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href || "";

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
      sessionStorage.removeItem("gm_tdev_intro_seen");
    } catch {}
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
      className={`portal-app flex h-screen h-[100dvh] overflow-hidden text-slate-800 ${
        navOpen ? "portal-nav-open" : ""
      }`}
      style={{ backgroundColor: "#f1f5f9" }}
    >
      {/* Mobile Drawer Backdrop */}
      <div
        id="portalNavBackdrop"
        className={`portal-nav-backdrop fixed inset-0 z-40 backdrop-blur-xs transition-opacity duration-200 ${
          navOpen ? "block opacity-100" : "hidden opacity-0 pointer-events-none"
        }`}
        style={{ backgroundColor: "rgba(7, 17, 32, 0.6)" }}
        onClick={() => setNavOpen(false)}
      />

      {/* Sidebar Navigation — Navy Blue */}
      <aside
        id="portalSidebar"
        className={`portal-sidebar fixed lg:static inset-y-0 left-0 z-50 w-72 lg:w-64 flex flex-col shrink-0 transition-transform duration-200 ease-in-out ${
          navOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full lg:translate-x-0"
        }`}
        style={{ backgroundColor: "#071120", color: "#c5d8f0" }}
      >
        {/* Sidebar Header / Brand */}
        <div
          className="p-5 sm:p-6 flex items-center justify-between gap-2"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div className="portal-sidebar-brand flex items-center gap-3 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/assets/icons/logo.jpg"
              alt="Gracemark Logo"
              className="w-9 h-9 rounded-xl object-cover flex-shrink-0"
              style={{ boxShadow: "0 0 0 2px rgba(201,168,76,0.5)" }}
            />
            <div className="min-w-0">
              <h2
                className="text-base font-bold tracking-tight leading-none"
                style={{ color: "#ffffff" }}
              >
                Gracemark
              </h2>
              <p
                className="text-[10px] font-semibold mt-1 uppercase tracking-wider"
                style={{ color: "#c9a84c" }}
              >
                {role === "admin" && "Admin Portal"}
                {role === "teacher" && "Teacher Portal"}
                {role === "student" && "Student Portal"}
              </p>
            </div>
          </div>
          <button
            type="button"
            id="portalMenuClose"
            className="lg:hidden p-2 rounded-lg transition cursor-pointer"
            style={{ color: "#7ba3d8" }}
            aria-label="Close navigation menu"
            onClick={() => setNavOpen(false)}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto text-sm font-medium">
          {categories.map((cat, idx) => (
            <React.Fragment key={idx}>
              {cat.name && (
                <div
                  className="pt-4 pb-1.5 text-[10px] font-bold uppercase px-3 tracking-widest"
                  style={{ color: "rgba(197, 216, 240, 0.45)" }}
                >
                  {cat.name}
                </div>
              )}
              {cat.items.map((item) => {
                const isActive = item.href === activeHref;

                if (item.disabled) {
                  return (
                    <div
                      key={item.href}
                      role="link"
                      aria-disabled="true"
                      title="Not available"
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-not-allowed select-none"
                      style={{ color: "#a8c4e0", opacity: 0.4, borderLeft: "3px solid transparent" }}
                    >
                      <span style={{ opacity: 0.75 }}>{item.icon}</span>
                      <span className="truncate">{item.label}</span>
                      <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ backgroundColor: "rgba(255,255,255,0.1)" }}>
                        Not available
                      </span>
                    </div>
                  );
                }

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setNavOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150"
                    style={
                      isActive
                        ? {
                            backgroundColor: "rgba(201, 168, 76, 0.15)",
                            color: "#e8c97a",
                            fontWeight: 600,
                            borderLeft: "3px solid #c9a84c",
                          }
                        : {
                            color: "#a8c4e0",
                            borderLeft: "3px solid transparent",
                          }
                    }
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(74,124,199,0.15)";
                        (e.currentTarget as HTMLElement).style.color = "#ffffff";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        (e.currentTarget as HTMLElement).style.backgroundColor = "";
                        (e.currentTarget as HTMLElement).style.color = "#a8c4e0";
                      }
                    }}
                  >
                    <span style={{ opacity: isActive ? 1 : 0.75 }}>{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                    {item.badge && (
                      <span
                        className="ml-auto text-xs px-2 py-0.5 rounded-full font-bold"
                        style={{ backgroundColor: "rgba(201,168,76,0.2)", color: "#e8c97a" }}
                      >
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </React.Fragment>
          ))}
        </nav>

        {/* Sign Out Footer */}
        <div className="p-3" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <button
            id="logoutBtn"
            type="button"
            onClick={handleSignOut}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl transition-all duration-150 cursor-pointer text-xs font-semibold"
            style={{ color: "#7ba3d8" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(220,38,38,0.15)";
              (e.currentTarget as HTMLElement).style.color = "#fca5a5";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "";
              (e.currentTarget as HTMLElement).style.color = "#7ba3d8";
            }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        {/* Mobile Header Bar */}
        <div
          className="lg:hidden sticky top-0 z-30 flex items-center justify-between px-3.5 py-2.5 shrink-0 shadow-md"
          style={{
            backgroundColor: "#071120",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            color: "#ffffff",
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              id="portalMobileHamburgerBtn"
              onClick={() => setNavOpen(true)}
              aria-label="Open navigation menu"
              className="p-2 rounded-xl transition shrink-0 cursor-pointer active:scale-95"
              style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "#c5d8f0" }}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="flex items-center gap-2 min-w-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/assets/icons/logo.jpg"
                alt="Gracemark Logo"
                className="w-7 h-7 rounded-lg object-cover shrink-0"
              />
              <span className="font-bold text-sm tracking-tight text-white truncate">Gracemark</span>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider shrink-0"
                style={
                  role === "admin"
                    ? {
                        backgroundColor: "rgba(201,168,76,0.2)",
                        color: "#e8c97a",
                        border: "1px solid rgba(201,168,76,0.4)",
                      }
                    : role === "teacher"
                    ? {
                        backgroundColor: "rgba(74,124,199,0.2)",
                        color: "#7ba3d8",
                        border: "1px solid rgba(74,124,199,0.4)",
                      }
                    : {
                        backgroundColor: "rgba(16,185,129,0.2)",
                        color: "#6ee7b7",
                        border: "1px solid rgba(16,185,129,0.35)",
                      }
                }
              >
                {role}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            className="p-2 rounded-xl transition text-xs flex items-center gap-1 cursor-pointer shrink-0"
            style={{ color: "#7ba3d8" }}
            title="Sign Out"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
          </button>
        </div>

        {/* Desktop / Page-Specific Header */}
        {(title || headerActions) && (
          <header className="portal-header hidden lg:flex bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 items-center justify-between gap-3 sticky top-0 z-20 shrink-0">
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
              <div className="portal-header-actions flex items-center gap-2">{headerActions}</div>
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
