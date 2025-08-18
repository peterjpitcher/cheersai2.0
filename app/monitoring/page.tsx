"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getPerformanceMonitor } from "@/lib/monitoring/performance";
import {
  Activity, AlertTriangle, Clock, ChevronLeft, 
  Loader2, RefreshCw, Zap, AlertCircle, CheckCircle,
  TrendingUp, TrendingDown, Server
} from "lucide-react";
import Link from "next/link";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface PerformanceData {
  avgPageLoad: number;
  avgApiResponse: number;
  publishingSuccess: number;
  errorRate: number;
  criticalErrors: number;
  totalMetrics: number;
  metrics: any[];
  errors: any[];
}

export default function MonitoringPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'hour' | 'day' | 'week' | 'month'>('day');
  const [performanceData, setPerformanceData] = useState<PerformanceData | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchPerformanceData();
    const interval = setInterval(fetchPerformanceData, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [timeRange]);

  const fetchPerformanceData = async () => {
    try {
      const monitor = getPerformanceMonitor();
      const data = await monitor.getPerformanceSummary(timeRange);
      
      if (data) {
        setPerformanceData(data as PerformanceData);
      }
    } catch (error) {
      console.error("Error fetching performance data:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchPerformanceData();
  };

  const getStatusColor = (value: number, type: 'load' | 'api' | 'success' | 'error') => {
    switch (type) {
      case 'load':
        return value < 2000 ? 'text-success' : value < 4000 ? 'text-warning' : 'text-error';
      case 'api':
        return value < 500 ? 'text-success' : value < 1000 ? 'text-warning' : 'text-error';
      case 'success':
        return value > 95 ? 'text-success' : value > 80 ? 'text-warning' : 'text-error';
      case 'error':
        return value === 0 ? 'text-success' : value < 5 ? 'text-warning' : 'text-error';
      default:
        return 'text-text-primary';
    }
  };

  const getStatusIcon = (value: number, type: 'load' | 'api' | 'success' | 'error') => {
    const isGood = 
      (type === 'load' && value < 2000) ||
      (type === 'api' && value < 500) ||
      (type === 'success' && value > 95) ||
      (type === 'error' && value === 0);
    
    return isGood ? TrendingUp : TrendingDown;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Prepare chart data
  const pageLoadData = performanceData?.metrics
    .filter(m => m.metric_type === 'page_load')
    .slice(-20)
    .map(m => ({
      time: new Date(m.created_at).toLocaleTimeString('en-GB', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      value: m.value
    })) || [];

  const chartData = {
    labels: pageLoadData.map(d => d.time),
    datasets: [
      {
        label: 'Page Load Time (ms)',
        data: pageLoadData.map(d => d.value),
        borderColor: 'rgb(234, 88, 12)',
        backgroundColor: 'rgba(234, 88, 12, 0.1)',
        tension: 0.4
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context: any) => `${context.parsed.y}ms`
        }
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: (value: any) => `${value}ms`
        }
      }
    }
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
                <h1 className="text-2xl font-heading font-bold">Performance Monitoring</h1>
                <p className="text-sm text-text-secondary">
                  Real-time system performance metrics
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value as any)}
                className="input-field py-2 px-3 text-sm"
              >
                <option value="hour">Last Hour</option>
                <option value="day">Last 24 Hours</option>
                <option value="week">Last 7 Days</option>
                <option value="month">Last 30 Days</option>
              </select>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="btn-secondary"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <Clock className="w-8 h-8 text-primary" />
              {performanceData && (
                <span className={`text-xs font-medium ${getStatusColor(performanceData.avgPageLoad, 'load')}`}>
                  {performanceData.avgPageLoad < 2000 ? 'Good' : performanceData.avgPageLoad < 4000 ? 'Fair' : 'Poor'}
                </span>
              )}
            </div>
            <p className="text-2xl font-bold">
              {performanceData?.avgPageLoad.toFixed(0) || 0}ms
            </p>
            <p className="text-sm text-text-secondary">Avg Page Load</p>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <Zap className="w-8 h-8 text-yellow-500" />
              {performanceData && (
                <span className={`text-xs font-medium ${getStatusColor(performanceData.avgApiResponse, 'api')}`}>
                  {performanceData.avgApiResponse < 500 ? 'Fast' : performanceData.avgApiResponse < 1000 ? 'Normal' : 'Slow'}
                </span>
              )}
            </div>
            <p className="text-2xl font-bold">
              {performanceData?.avgApiResponse.toFixed(0) || 0}ms
            </p>
            <p className="text-sm text-text-secondary">Avg API Response</p>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle className="w-8 h-8 text-success" />
              {performanceData && (
                <span className={`text-xs font-medium ${getStatusColor(performanceData.publishingSuccess, 'success')}`}>
                  {performanceData.publishingSuccess > 95 ? 'Excellent' : performanceData.publishingSuccess > 80 ? 'Good' : 'Needs Attention'}
                </span>
              )}
            </div>
            <p className="text-2xl font-bold">
              {performanceData?.publishingSuccess.toFixed(1) || 0}%
            </p>
            <p className="text-sm text-text-secondary">Publishing Success</p>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <AlertTriangle className="w-8 h-8 text-error" />
              {performanceData && (
                <span className={`text-xs font-medium ${getStatusColor(performanceData.errorRate, 'error')}`}>
                  {performanceData.errorRate === 0 ? 'None' : performanceData.errorRate < 5 ? 'Low' : 'High'}
                </span>
              )}
            </div>
            <p className="text-2xl font-bold">
              {performanceData?.errorRate || 0}
            </p>
            <p className="text-sm text-text-secondary">
              Errors ({performanceData?.criticalErrors || 0} critical)
            </p>
          </div>
        </div>

        {/* Performance Chart */}
        <div className="card mb-8">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Page Load Performance
          </h3>
          <div className="h-64">
            {pageLoadData.length > 0 ? (
              <Line data={chartData} options={chartOptions} />
            ) : (
              <div className="h-full flex items-center justify-center text-text-secondary">
                No performance data available for this time range
              </div>
            )}
          </div>
        </div>

        {/* System Health */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Recent Errors */}
          <div className="card">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-error" />
              Recent Errors
            </h3>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {performanceData?.errors.slice(0, 10).length === 0 ? (
                <p className="text-sm text-text-secondary text-center py-8">
                  No errors in the selected time range
                </p>
              ) : (
                performanceData?.errors.slice(0, 10).map((error, index) => (
                  <div key={index} className="p-3 bg-gray-50 rounded-medium">
                    <div className="flex items-start justify-between mb-1">
                      <p className="text-sm font-medium">{error.context}</p>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        error.severity === 'critical' ? 'bg-red-100 text-red-700' :
                        error.severity === 'high' ? 'bg-orange-100 text-orange-700' :
                        error.severity === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {error.severity}
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary mb-1">
                      {error.error_message}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {new Date(error.created_at).toLocaleString('en-GB')}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Performance Metrics */}
          <div className="card">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Server className="w-5 h-5 text-primary" />
              System Metrics
            </h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded-medium">
                <div>
                  <p className="font-medium">Total Metrics Collected</p>
                  <p className="text-xs text-text-secondary">In selected time range</p>
                </div>
                <p className="text-2xl font-bold">{performanceData?.totalMetrics || 0}</p>
              </div>

              <div className="flex justify-between items-center p-3 bg-gray-50 rounded-medium">
                <div>
                  <p className="font-medium">API Calls</p>
                  <p className="text-xs text-text-secondary">Total requests</p>
                </div>
                <p className="text-2xl font-bold">
                  {performanceData?.metrics.filter(m => m.metric_type === 'api_call').length || 0}
                </p>
              </div>

              <div className="flex justify-between items-center p-3 bg-gray-50 rounded-medium">
                <div>
                  <p className="font-medium">User Actions</p>
                  <p className="text-xs text-text-secondary">Tracked interactions</p>
                </div>
                <p className="text-2xl font-bold">
                  {performanceData?.metrics.filter(m => m.metric_type === 'user_action').length || 0}
                </p>
              </div>

              <div className="flex justify-between items-center p-3 bg-gray-50 rounded-medium">
                <div>
                  <p className="font-medium">AI Generations</p>
                  <p className="text-xs text-text-secondary">Content created</p>
                </div>
                <p className="text-2xl font-bold">
                  {performanceData?.metrics.filter(m => m.metric_type === 'ai_generation').length || 0}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Status Indicators */}
        <div className="card">
          <h3 className="font-semibold mb-4">System Status</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-medium">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${
                  performanceData && performanceData.criticalErrors === 0 
                    ? 'bg-success animate-pulse' 
                    : 'bg-error'
                }`} />
                <span className="font-medium">API Health</span>
              </div>
              <span className="text-sm text-text-secondary">
                {performanceData && performanceData.criticalErrors === 0 ? 'Operational' : 'Issues Detected'}
              </span>
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-medium">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${
                  performanceData && performanceData.avgPageLoad < 3000 
                    ? 'bg-success animate-pulse' 
                    : 'bg-warning'
                }`} />
                <span className="font-medium">Performance</span>
              </div>
              <span className="text-sm text-text-secondary">
                {performanceData && performanceData.avgPageLoad < 3000 ? 'Optimal' : 'Degraded'}
              </span>
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-medium">
              <div className={`flex items-center gap-3`}>
                <div className={`w-3 h-3 rounded-full ${
                  performanceData && performanceData.publishingSuccess > 90 
                    ? 'bg-success animate-pulse' 
                    : 'bg-warning'
                }`} />
                <span className="font-medium">Publishing</span>
              </div>
              <span className="text-sm text-text-secondary">
                {performanceData && performanceData.publishingSuccess > 90 ? 'Healthy' : 'Unstable'}
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}