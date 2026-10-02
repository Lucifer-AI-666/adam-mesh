import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { NotificationProvider } from "./contexts/NotificationContext";
import Home from "./pages/Home";
import Chat from "./pages/Chat";
import NodesMap from "./pages/NodesMap";
import History from "./pages/History";
import Dashboard from "./pages/Dashboard";
import Escalations from "./pages/Escalations";
import AdminNodes from "./pages/AdminNodes";
import AdminKnowledge from "./pages/AdminKnowledge";
import AdminSettings from "./pages/AdminSettings";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/chat"} component={Chat} />
      <Route path={"/chat/:id"} component={Chat} />
      <Route path={"/map"} component={NodesMap} />
      <Route path={"/history"} component={History} />
      <Route path={"/dashboard"} component={Dashboard} />
      <Route path={"/escalations"} component={Escalations} />
      <Route path={"/admin/nodes"} component={AdminNodes} />
      <Route path={"/admin/knowledge"} component={AdminKnowledge} />
      <Route path={"/admin/settings"} component={AdminSettings} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <NotificationProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </NotificationProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
