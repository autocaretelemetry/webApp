import { useGetCenterDashboard, useListActivity } from "@workspace/api-client-react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBreakdownChart } from "@/components/StatusBreakdownChart";
import { MechanicCard } from "@/components/MechanicCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wrench, Clock, CheckCircle, DollarSign, Activity } from "lucide-react";
import { formatCurrency, formatRelative } from "@/lib/format";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function CenterDashboard() {
  const { data: dashboard, isLoading: isLoadingDashboard } = useGetCenterDashboard();
  const { data: activities, isLoading: isLoadingActivity } = useListActivity({ role: "center", limit: 8 });

  if (isLoadingDashboard) {
    return <div className="p-8">Loading dashboard...</div>;
  }

  if (!dashboard) {
    return <div className="p-8">Error loading dashboard</div>;
  }

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <PageHeader 
        title="Service Center Dashboard" 
        description="Overview of your shop's operations and performance."
        actions={
          <Link href="/jobs">
            <Button>Manage Jobs</Button>
          </Link>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Requests</CardTitle>
            <Clock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard.pendingRequests}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Jobs In Progress</CardTitle>
            <Wrench className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard.jobsInProgress}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed Today</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard.completedToday}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Revenue (Month)</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(dashboard.revenueThisMonth)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <StatusBreakdownChart data={dashboard.statusBreakdown} title="Active Jobs Breakdown" />
        
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-5 w-5" /> Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto">
            {isLoadingActivity ? (
              <div>Loading activity...</div>
            ) : activities && activities.length > 0 ? (
              <div className="space-y-4">
                {activities.map((activity) => (
                  <div key={activity.id} className="flex flex-col gap-1 border-b pb-2 last:border-0 last:pb-0">
                    <span className="text-sm">{activity.message}</span>
                    <span className="text-xs text-muted-foreground">{formatRelative(activity.at)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground text-sm py-4">No recent activity.</div>
            )}
          </CardContent>
        </Card>
      </div>
      
      {dashboard.topMechanics && dashboard.topMechanics.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-4">Top Mechanics</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
             {dashboard.topMechanics.map(mechanic => (
               <MechanicCard key={mechanic.id} mechanic={mechanic} />
             ))}
          </div>
        </div>
      )}
    </div>
  );
}
