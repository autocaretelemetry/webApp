import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { StatusCount } from "@workspace/api-client-react";
import { BOOKING_STATUS_CONFIG } from "@/lib/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface StatusBreakdownChartProps {
  data: StatusCount[];
  title?: string;
}

export function StatusBreakdownChart({ data, title = "Status Breakdown" }: StatusBreakdownChartProps) {
  const chartData = useMemo(() => {
    return data.map((item) => ({
      name: BOOKING_STATUS_CONFIG[item.status as keyof typeof BOOKING_STATUS_CONFIG]?.label || item.status,
      value: item.count,
      // Extract color from tailwind classes (basic mapping for pie chart)
      color: getStatusColor(item.status),
    }));
  }, [data]);

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center text-muted-foreground">
          No data available
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={80}
              paddingAngle={5}
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip 
              formatter={(value: number) => [`${value} bookings`, "Count"]}
              contentStyle={{ borderRadius: "8px", border: "1px solid var(--border)" }}
            />
            <Legend verticalAlign="bottom" height={36} />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// Simple color mapper for pie chart since we can't easily use tailwind classes directly in recharts
function getStatusColor(status: string) {
  switch (status) {
    case "requested": return "#f59e0b"; // amber-500
    case "accepted": return "#3b82f6"; // blue-500
    case "in_progress": return "#6366f1"; // indigo-500
    case "awaiting_approval": return "hsl(var(--primary))"; // primary
    case "approved": return "#14b8a6"; // teal-500
    case "completed": return "#22c55e"; // green-500
    case "cancelled": return "#6b7280"; // gray-500
    case "rejected": return "#ef4444"; // red-500
    default: return "#cbd5e1"; // gray-300
  }
}
