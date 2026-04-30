import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Home from "./pages/Home";
import Login from "./pages/Login";
import PkgWipSummary from "./pages/PkgWipSummary";
import OutsourceOrderDetail from "./pages/OutsourceOrderDetail";
import PkgWipDetail from "./pages/PkgWipDetail";
import PkgWipInprocDetail from "./pages/PkgWipInprocDetail";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminPermissions from "./pages/admin/AdminPermissions";
import AdminReportModules from "./pages/admin/AdminReportModules";
import AdminDatasources from "./pages/admin/AdminDatasources";
import AdminSystemConfig from "./pages/admin/AdminSystemConfig";

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
        <Route path="/reports/pkg-wip-summary" component={PkgWipSummary} />
        <Route path="/reports/outsource-order-detail" component={OutsourceOrderDetail} />
        <Route path="/reports/pkg-wip-detail" component={PkgWipDetail} />
        <Route path="/reports/pkg-wip-inproc-detail" component={PkgWipInprocDetail} />
        <Route path="/admin/users" component={AdminUsers} />
        <Route path="/admin/permissions" component={AdminPermissions} />
        <Route path="/admin/report-modules" component={AdminReportModules} />
        <Route path="/admin/datasources" component={AdminDatasources} />
        <Route path="/admin/system-config" component={AdminSystemConfig} />
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
