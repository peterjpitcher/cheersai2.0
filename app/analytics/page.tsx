"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  BarChart3, TrendingUp, Calendar, ChevronLeft, Loader2, Download,
  Facebook, Instagram, MapPin, CheckCircle, Clock, XCircle
} from "lucide-react";
import Link from "next/link";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
} from "chart.js";
import { Line, Bar, Doughnut } from "react-chartjs-2";

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

interface AnalyticsData {
  totalPosts: number;
  publishedPosts: number;
  failedPosts: number;
  scheduledPosts: number;
  platformBreakdown: {
    facebook: number;
    instagram: number;
    google: number;
  };
  monthlyPosts: Array<{
    month: string;
    count: number;
  }>;
  topCampaigns: Array<{
    id: string;
    name: string;
    posts: number;
  }>;
  recentActivity: Array<{
    id: string;
    campaign: string;
    platform: string;
    status: string;
    date: string;
  }>;
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState("30");
  const [analytics, setAnalytics] = useState<AnalyticsData>({
    totalPosts: 0,
    publishedPosts: 0,
    failedPosts: 0,
    scheduledPosts: 0,
    platformBreakdown: { facebook: 0, instagram: 0, google: 0 },
    monthlyPosts: [],
    topCampaigns: [],
    recentActivity: []
  });

  useEffect(() => {
    fetchAnalytics();
  }, [dateRange]);

  const fetchAnalytics = async () => {
    setLoading(true);
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/auth/login");
      return;
    }

    // Get user's tenant
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) return;

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(dateRange));

    // Get publishing history
    const { data: history } = await supabase
      .from("publishing_history")
      .select(`
        *,
        campaign_posts!inner (
          tenant_id,
          campaigns (
            name
          )
        ),
        social_connections (
          platform,
          page_name
        )
      `)
      .eq("campaign_posts.tenant_id", userData.tenant_id)
      .gte("created_at", startDate.toISOString())
      .order("created_at", { ascending: false });

    // Get scheduled posts
    const { data: scheduled } = await supabase
      .from("publishing_queue")
      .select(`
        *,
        campaign_posts!inner (
          tenant_id
        )
      `)
      .eq("campaign_posts.tenant_id", userData.tenant_id)
      .eq("status", "pending");

    // Process analytics data
    if (history) {
      const published = history.filter(h => h.status === "published").length;
      const failed = history.filter(h => h.status === "failed").length;
      
      // Platform breakdown
      const platformCounts = {
        facebook: history.filter(h => h.social_connections?.platform === "facebook").length,
        instagram: history.filter(h => h.social_connections?.platform === "instagram").length,
        google: history.filter(h => h.social_connections?.platform === "google_my_business").length,
      };

      // Monthly posts
      const monthlyData = new Map<string, number>();
      history.forEach(post => {
        const month = new Date(post.created_at).toLocaleDateString("en-GB", { 
          month: "short",
          year: "numeric"
        });
        monthlyData.set(month, (monthlyData.get(month) || 0) + 1);
      });

      // Top campaigns
      const campaignMap = new Map<string, { name: string; count: number }>();
      history.forEach(post => {
        const campaignName = post.campaign_posts?.campaigns?.name || "Unknown";
        const current = campaignMap.get(campaignName) || { name: campaignName, count: 0 };
        campaignMap.set(campaignName, { ...current, count: current.count + 1 });
      });

      const topCampaigns = Array.from(campaignMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map((c, i) => ({ id: String(i), name: c.name, posts: c.count }));

      // Recent activity
      const recentActivity = history.slice(0, 10).map(post => ({
        id: post.id,
        campaign: post.campaign_posts?.campaigns?.name || "Unknown",
        platform: post.social_connections?.platform || "unknown",
        status: post.status,
        date: post.created_at
      }));

      setAnalytics({
        totalPosts: history.length,
        publishedPosts: published,
        failedPosts: failed,
        scheduledPosts: scheduled?.length || 0,
        platformBreakdown: platformCounts,
        monthlyPosts: Array.from(monthlyData.entries()).map(([month, count]) => ({
          month,
          count
        })).reverse().slice(0, 6),
        topCampaigns,
        recentActivity
      });
    }

    setLoading(false);
  };

  const exportAnalytics = () => {
    const csv = [
      ["Metric", "Value"],
      ["Total Posts", analytics.totalPosts],
      ["Published", analytics.publishedPosts],
      ["Failed", analytics.failedPosts],
      ["Scheduled", analytics.scheduledPosts],
      ["Facebook Posts", analytics.platformBreakdown.facebook],
      ["Instagram Posts", analytics.platformBreakdown.instagram],
      ["Google Posts", analytics.platformBreakdown.google],
    ].map(row => row.join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Chart configurations
  const lineChartData = {
    labels: analytics.monthlyPosts.map(m => m.month),
    datasets: [
      {
        label: "Posts Published",
        data: analytics.monthlyPosts.map(m => m.count),
        borderColor: "rgb(234, 88, 12)",
        backgroundColor: "rgba(234, 88, 12, 0.1)",
        tension: 0.4
      }
    ]
  };

  const doughnutChartData = {
    labels: ["Facebook", "Instagram", "Google"],
    datasets: [
      {
        data: [
          analytics.platformBreakdown.facebook,
          analytics.platformBreakdown.instagram,
          analytics.platformBreakdown.google
        ],
        backgroundColor: [
          "rgb(59, 130, 246)",
          "rgb(168, 85, 247)",
          "rgb(34, 197, 94)"
        ]
      }
    ]
  };

  const barChartData = {
    labels: analytics.topCampaigns.map(c => c.name),
    datasets: [
      {
        label: "Posts",
        data: analytics.topCampaigns.map(c => c.posts),
        backgroundColor: "rgba(234, 88, 12, 0.8)"
      }
    ]
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="text-text-secondary hover:text-primary">
                <ChevronLeft className="w-6 h-6" />
              </Link>
              <div>
                <h1 className="text-2xl font-heading font-bold">Analytics</h1>
                <p className="text-sm text-text-secondary">
                  Track your social media performance
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                className="input-field py-2 px-3 text-sm"
              >
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="365">Last year</option>
              </select>
              <button onClick={exportAnalytics} className="btn-secondary">
                <Download className="w-4 h-4 mr-2" />
                Export
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <BarChart3 className="w-8 h-8 text-primary" />
              <span className="text-xs text-success bg-success/10 px-2 py-1 rounded-full">
                +12%
              </span>
            </div>
            <p className="text-2xl font-bold">{analytics.totalPosts}</p>
            <p className="text-sm text-text-secondary">Total Posts</p>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle className="w-8 h-8 text-success" />
            </div>
            <p className="text-2xl font-bold">{analytics.publishedPosts}</p>
            <p className="text-sm text-text-secondary">Published</p>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <Clock className="w-8 h-8 text-warning" />
            </div>
            <p className="text-2xl font-bold">{analytics.scheduledPosts}</p>
            <p className="text-sm text-text-secondary">Scheduled</p>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <XCircle className="w-8 h-8 text-error" />
            </div>
            <p className="text-2xl font-bold">{analytics.failedPosts}</p>
            <p className="text-sm text-text-secondary">Failed</p>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Monthly Trend */}
          <div className="lg:col-span-2 card">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              Publishing Trend
            </h3>
            <div className="h-64">
              <Line 
                data={lineChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false }
                  },
                  scales: {
                    y: {
                      beginAtZero: true,
                      ticks: { stepSize: 1 }
                    }
                  }
                }}
              />
            </div>
          </div>

          {/* Platform Distribution */}
          <div className="card">
            <h3 className="font-semibold mb-4">Platform Distribution</h3>
            <div className="h-64 flex items-center justify-center">
              <Doughnut 
                data={doughnutChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: "bottom"
                    }
                  }
                }}
              />
            </div>
          </div>
        </div>

        {/* Top Campaigns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="card">
            <h3 className="font-semibold mb-4">Top Campaigns</h3>
            <div className="h-64">
              <Bar 
                data={barChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false }
                  },
                  scales: {
                    y: {
                      beginAtZero: true,
                      ticks: { stepSize: 1 }
                    }
                  }
                }}
              />
            </div>
          </div>

          {/* Quick Stats */}
          <div className="card">
            <h3 className="font-semibold mb-4">Performance Metrics</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded-medium">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-success/10 rounded-full flex items-center justify-center">
                    <CheckCircle className="w-5 h-5 text-success" />
                  </div>
                  <div>
                    <p className="font-medium">Success Rate</p>
                    <p className="text-xs text-text-secondary">Publishing success</p>
                  </div>
                </div>
                <p className="text-2xl font-bold text-success">
                  {analytics.totalPosts > 0 
                    ? Math.round((analytics.publishedPosts / analytics.totalPosts) * 100)
                    : 0}%
                </p>
              </div>

              <div className="flex justify-between items-center p-3 bg-gray-50 rounded-medium">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                    <Calendar className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Avg. Posts/Day</p>
                    <p className="text-xs text-text-secondary">Last {dateRange} days</p>
                  </div>
                </div>
                <p className="text-2xl font-bold">
                  {(analytics.totalPosts / parseInt(dateRange)).toFixed(1)}
                </p>
              </div>

              <div className="flex justify-between items-center p-3 bg-gray-50 rounded-medium">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <Facebook className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-medium">Most Used Platform</p>
                    <p className="text-xs text-text-secondary">Primary channel</p>
                  </div>
                </div>
                <p className="text-lg font-bold">
                  {Object.entries(analytics.platformBreakdown)
                    .sort(([,a], [,b]) => b - a)[0]?.[0] || "None"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="card">
          <h3 className="font-semibold mb-4">Recent Activity</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Campaign
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Platform
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Status
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {analytics.recentActivity.map((activity) => (
                  <tr key={activity.id} className="border-b border-border hover:bg-gray-50">
                    <td className="py-3 px-4">
                      <p className="text-sm font-medium">{activity.campaign}</p>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        {activity.platform === "facebook" && <Facebook className="w-4 h-4 text-blue-600" />}
                        {activity.platform === "instagram" && <Instagram className="w-4 h-4 text-purple-600" />}
                        {activity.platform === "google_my_business" && <MapPin className="w-4 h-4 text-green-600" />}
                        <span className="text-sm capitalize">{activity.platform.replace("_", " ")}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        activity.status === "published" 
                          ? "bg-success/10 text-success"
                          : "bg-error/10 text-error"
                      }`}>
                        {activity.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-text-secondary">
                      {new Date(activity.date).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}