import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import NotificationCenter from "@/components/NotificationCenter";
import { getLoginUrl } from "@/const";
import { cn } from "@/lib/utils";
import { Menu, X, MessageSquare, Map, History, BarChart3, AlertTriangle, Database, BookOpen, LogOut, Zap } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";

export default function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const publicLinks = [
    { href: "/chat", label: "Chat", icon: MessageSquare },
    { href: "/map", label: "Mappa", icon: Map },
  ];

  const authLinks = [
    { href: "/history", label: "Storico", icon: History },
  ];

  const operatorLinks = [
    { href: "/escalations", label: "Escalation", icon: AlertTriangle },
  ];

  const adminLinks = [
    { href: "/dashboard", label: "Analytics", icon: BarChart3 },
    { href: "/admin/nodes", label: "Nodi", icon: Database },
    { href: "/admin/knowledge", label: "Knowledge", icon: BookOpen },
  ];

  const allLinks = [
    ...publicLinks,
    ...(isAuthenticated ? authLinks : []),
    ...(user?.role === "operator" || user?.role === "admin" ? operatorLinks : []),
    ...(user?.role === "admin" ? adminLinks : []),
  ];

  // One-click instant login — redirect to current page after auth
  const handleInstantLogin = () => {
    window.location.href = getLoginUrl();
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="container flex h-14 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg tracking-tight">
          <span className="text-primary">ADAM</span>
          <span className="hidden sm:inline text-muted-foreground text-sm font-normal">Acqui Digital Mesh</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {allLinks.map(link => (
            <Link key={link.href} href={link.href}>
              <Button
                variant={location === link.href ? "secondary" : "ghost"}
                size="sm"
                className={cn("gap-1.5 text-xs", location === link.href && "text-primary")}
              >
                <link.icon className="h-3.5 w-3.5" />
                {link.label}
              </Button>
            </Link>
          ))}
          <div className="ml-2 border-l border-border pl-2 flex items-center gap-1">
            <NotificationCenter />
            {isAuthenticated ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground hidden lg:inline">{user?.name || "Utente"}</span>
                <Button variant="ghost" size="sm" onClick={() => logout()} className="gap-1.5 text-xs">
                  <LogOut className="h-3.5 w-3.5" />
                  Esci
                </Button>
              </div>
            ) : (
              <Button
                variant="default"
                size="sm"
                className="gap-1.5 text-xs font-semibold"
                onClick={handleInstantLogin}
              >
                <Zap className="h-3.5 w-3.5" />
                Entra Subito
              </Button>
            )}
          </div>
        </div>

        {/* Mobile toggle */}
        <Button variant="ghost" size="sm" className="md:hidden" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-background p-4 space-y-1">
          {allLinks.map(link => (
            <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)}>
              <Button
                variant={location === link.href ? "secondary" : "ghost"}
                className="w-full justify-start gap-2"
              >
                <link.icon className="h-4 w-4" />
                {link.label}
              </Button>
            </Link>
          ))}
          <div className="pt-2 border-t border-border">
            {isAuthenticated ? (
              <Button variant="ghost" className="w-full justify-start gap-2" onClick={() => logout()}>
                <LogOut className="h-4 w-4" />
                Esci ({user?.name || "Utente"})
              </Button>
            ) : (
              <Button
                variant="default"
                className="w-full gap-2 font-semibold"
                onClick={handleInstantLogin}
              >
                <Zap className="h-4 w-4" />
                Entra Subito
              </Button>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
