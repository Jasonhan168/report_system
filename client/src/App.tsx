import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Home from "./pages/Home";
import Login from "./pages/Login";
import { REPORT_ROUTES } from "./reports";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminPermissions from "./pages/admin/AdminPermissions";
import AdminReportModules from "./pages/admin/AdminReportModules";
import AdminDatasources from "./pages/admin/AdminDatasources";
import AdminSystemConfig from "./pages/admin/AdminSystemConfig";
import AdminOperationLogs from "./pages/admin/AdminOperationLogs";

function Router() {
  const [location] = useLocation();

  // 登录页面不需要 DashboardLayout
  if (location === "/login") {
    return (
      <Switch>
        <Route path="/login" component={Login} />
      </Switch>
    );
  }

  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Home} />
        {REPORT_ROUTES.map(({ path, component }) => (
          <Route key={path} path={path} component={component} />
        ))}
        <Route path="/admin/users" component={AdminUsers} />
        <Route path="/admin/permissions" component={AdminPermissions} />
        <Route path="/admin/report-modules" component={AdminReportModules} />
        <Route path="/admin/datasources" component={AdminDatasources} />
        <Route path="/admin/system-config" component={AdminSystemConfig} />
        <Route path="/admin/operation-logs" component={AdminOperationLogs} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
