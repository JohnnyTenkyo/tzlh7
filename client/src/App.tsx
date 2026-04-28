import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Home from "./pages/Home";
import ChartPage from "./pages/ChartPage";
import BacktestPage from "./pages/BacktestPage";
import BacktestDetailPage from "./pages/BacktestDetailPage";
import StockPoolPage from "./pages/StockPoolPage";
import CachePage from "./pages/CachePage";
import HealthPage from "./pages/HealthPage";
import AuthPage from "./pages/AuthPage";
import SettingsPage from "./pages/SettingsPage";
import TodayScanPage from "./pages/TodayScanPage";
function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/chart" component={ChartPage} />
        <Route path="/backtest" component={BacktestPage} />
        <Route path="/backtest/:id" component={BacktestDetailPage} />
        <Route path="/stock-pool" component={StockPoolPage} />
        <Route path="/cache" component={CachePage} />
        <Route path="/health" component={HealthPage} />
        <Route path="/auth" component={AuthPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/scan" component={TodayScanPage} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
