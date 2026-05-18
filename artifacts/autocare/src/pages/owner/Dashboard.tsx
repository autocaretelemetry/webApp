import { useGetOwnerDashboard, useListActivity } from "@workspace/api-client-react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBreakdownChart } from "@/components/StatusBreakdownChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Car, Wrench, Clock, DollarSign, Activity } from "lucide-react";
import { formatCurrency, formatRelative } from "@/lib/format";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function OwnerDashboard() {
  const { data: dashboard, isLoading: isLoadingDashboard } = useGetOwnerDashboard();
  const { data: activities, isLoading: isLoadingActivity } = useListActivity({ role: "owner", limit: 8 });

  if (isLoadingDashboard) {
    return <div className="p-8">Loading dashboard...</div>;
  }

  if (!dashboard) {
    return <div className="p-8">Error loading dashboard</div>;
  }

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <PageHeader 
        title="Dashboard" 
        description="Overview of your vehicles and services."
        actions={
          <>
            <Link href="/vehicles/new">
              <Button variant="outline">Add Vehicle</Button>
            </Link>
            <Link href="/service-centers">
              <Button>Book Service</Button>
            </Link>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">My Vehicles</CardTitle>
            <Car className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard.vehiclesCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Bookings</CardTitle>
            <Wrench className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard.activeBookings}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Approvals</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard.pendingApprovals}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Lifetime Spend</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(dashboard.lifetimeSpend)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <StatusBreakdownChart data={dashboard.statusBreakdown} title="Bookings by Status" />
        
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
      
      {dashboard.upcomingReminders && dashboard.upcomingReminders.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-4">Upcoming Reminders</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
             {dashboard.upcomingReminders.map(reminder => (
               <Card key={reminder.id} className={reminder.urgency === 'high' ? 'border-destructive' : ''}>
                 <CardHeader className="pb-2">
                   <CardTitle className="text-md">{reminder.title}</CardTitle>
                 </CardHeader>
                 <CardContent>
                   <p className="text-sm text-muted-foreground mb-2">{reminder.detail}</p>
                   <div className="text-sm font-medium">Due: {formatRelative(reminder.dueAt)}</div>
                 </CardContent>
               </Card>
             ))}
          </div>
        </div>
      )}
    </div>
  );
}
