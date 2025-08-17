"use client";

import { useState } from "react";
import { 
  TrendingUp, TrendingDown, Users, Eye, Heart, MessageSquare,
  Calendar, Clock, BarChart3, PieChart, Activity, ChevronRight,
  Instagram, Sparkles, AlertCircle, Download, Filter, ArrowUp
} from "lucide-react";
import Link from "next/link";

// Demo page for instagram_business_manage_insights App Review
export default function InsightsDemoPage() {
  const [timeRange, setTimeRange] = useState<"week" | "month" | "quarter">("week");
  const [selectedPost, setSelectedPost] = useState<number | null>(null);

  // Demo data for insights
  const accountMetrics = {
    followers: 3847,
    followersChange: 12.5,
    reach: 15420,
    reachChange: 28.3,
    impressions: 42150,
    impressionsChange: 15.7,
    profileViews: 892,
    profileViewsChange: -5.2
  };

  const posts = [
    {
      id: 1,
      type: "Quiz Night",
      date: "Tuesday, 8pm",
      image: "🎤",
      impressions: 8420,
      reach: 3250,
      engagement: 452,
      engagementRate: 13.9,
      clicks: 89,
      saves: 34,
      comments: 28,
      likes: 390
    },
    {
      id: 2,
      type: "Happy Hour",
      date: "Friday, 5-7pm",
      image: "🍺",
      impressions: 12350,
      reach: 4820,
      engagement: 623,
      engagementRate: 12.9,
      clicks: 145,
      saves: 48,
      comments: 35,
      likes: 540
    },
    {
      id: 3,
      type: "Sunday Roast",
      date: "Sunday, 12-3pm",
      image: "🍖",
      impressions: 6890,
      reach: 2430,
      engagement: 287,
      engagementRate: 11.8,
      clicks: 67,
      saves: 52,
      comments: 15,
      likes: 220
    }
  ];

  const audienceInsights = {
    topLocations: [
      { name: "London Bridge", percentage: 45 },
      { name: "Borough", percentage: 28 },
      { name: "Southwark", percentage: 15 },
      { name: "Tower Bridge", percentage: 12 }
    ],
    ageGroups: [
      { range: "18-24", percentage: 15 },
      { range: "25-34", percentage: 38 },
      { range: "35-44", percentage: 27 },
      { range: "45-54", percentage: 14 },
      { range: "55+", percentage: 6 }
    ],
    peakTimes: [
      { day: "Monday", time: "6-7pm", activity: 85 },
      { day: "Tuesday", time: "7-8pm", activity: 92 },
      { day: "Wednesday", time: "5-6pm", activity: 78 },
      { day: "Thursday", time: "6-7pm", activity: 88 },
      { day: "Friday", time: "5-6pm", activity: 95 },
      { day: "Saturday", time: "4-5pm", activity: 82 },
      { day: "Sunday", time: "1-2pm", activity: 76 }
    ]
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-heading font-bold">Analytics & Insights Demo</h1>
              <p className="text-sm text-text-secondary">instagram_business_manage_insights - App Review</p>
            </div>
            <Link href="/dashboard" className="btn-ghost">
              Back to Dashboard
            </Link>
          </div>
        </div>
      </header>

      {/* Instructions Banner */}
      <div className="container mx-auto px-4 py-4">
        <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4">
          <h3 className="font-semibold text-yellow-900 mb-2">📍 App Review Recording Instructions:</h3>
          <ol className="text-sm text-yellow-800 space-y-1">
            <li>1. This demo shows how hospitality businesses track their Instagram performance</li>
            <li>2. See engagement metrics that help venues understand customer behavior</li>
            <li>3. Discover optimal posting times based on audience activity</li>
            <li>4. View actionable recommendations to improve social media ROI</li>
          </ol>
        </div>
      </div>

      <main className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Time Range Selector */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Instagram Business Insights</h2>
          <div className="flex gap-2">
            {(["week", "month", "quarter"] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  timeRange === range
                    ? "bg-primary text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                Last {range}
              </button>
            ))}
          </div>
        </div>

        {/* Account Overview Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="card">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-sm text-gray-600 mb-1">Followers</p>
                <p className="text-2xl font-bold">{accountMetrics.followers.toLocaleString()}</p>
              </div>
              <Users className="w-5 h-5 text-gray-400" />
            </div>
            <div className={`flex items-center gap-1 text-sm ${
              accountMetrics.followersChange > 0 ? "text-green-600" : "text-red-600"
            }`}>
              {accountMetrics.followersChange > 0 ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              <span>{Math.abs(accountMetrics.followersChange)}%</span>
            </div>
          </div>

          <div className="card">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-sm text-gray-600 mb-1">Reach</p>
                <p className="text-2xl font-bold">{accountMetrics.reach.toLocaleString()}</p>
              </div>
              <Eye className="w-5 h-5 text-gray-400" />
            </div>
            <div className="flex items-center gap-1 text-sm text-green-600">
              <TrendingUp className="w-4 h-4" />
              <span>{accountMetrics.reachChange}%</span>
            </div>
          </div>

          <div className="card">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-sm text-gray-600 mb-1">Impressions</p>
                <p className="text-2xl font-bold">{accountMetrics.impressions.toLocaleString()}</p>
              </div>
              <Activity className="w-5 h-5 text-gray-400" />
            </div>
            <div className="flex items-center gap-1 text-sm text-green-600">
              <TrendingUp className="w-4 h-4" />
              <span>{accountMetrics.impressionsChange}%</span>
            </div>
          </div>

          <div className="card">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-sm text-gray-600 mb-1">Profile Views</p>
                <p className="text-2xl font-bold">{accountMetrics.profileViews}</p>
              </div>
              <Users className="w-5 h-5 text-gray-400" />
            </div>
            <div className={`flex items-center gap-1 text-sm ${
              accountMetrics.profileViewsChange > 0 ? "text-green-600" : "text-red-600"
            }`}>
              <TrendingDown className="w-4 h-4" />
              <span>{Math.abs(accountMetrics.profileViewsChange)}%</span>
            </div>
          </div>
        </div>

        {/* How We Use This Permission */}
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-8">
          <h3 className="font-semibold text-purple-900 mb-2">
            <AlertCircle className="w-4 h-4 inline mr-1" />
            How CheersAI Uses instagram_business_manage_insights:
          </h3>
          <div className="grid md:grid-cols-2 gap-4 mt-3">
            <ul className="text-sm text-purple-800 space-y-1">
              <li>• Track post performance (impressions, reach, engagement)</li>
              <li>• Analyze audience demographics and behavior</li>
              <li>• Identify optimal posting times for your area</li>
            </ul>
            <ul className="text-sm text-purple-800 space-y-1">
              <li>• Measure campaign ROI and success metrics</li>
              <li>• Generate AI-powered recommendations</li>
              <li>• Compare performance across multiple venues</li>
            </ul>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Top Performing Posts */}
          <div className="lg:col-span-2">
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">Top Performing Posts</h3>
                <button className="text-sm text-primary hover:underline">
                  View All Posts →
                </button>
              </div>

              <div className="space-y-4">
                {posts.map((post) => (
                  <div
                    key={post.id}
                    onClick={() => setSelectedPost(post.id)}
                    className={`p-4 rounded-lg border-2 transition-all cursor-pointer ${
                      selectedPost === post.id
                        ? "border-primary bg-primary/5"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center text-2xl">
                        {post.image}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h4 className="font-medium">{post.type}</h4>
                            <p className="text-sm text-gray-500">{post.date}</p>
                          </div>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            post.engagementRate > 13
                              ? "bg-green-100 text-green-700"
                              : "bg-yellow-100 text-yellow-700"
                          }`}>
                            {post.engagementRate}% engagement
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-gray-500">Impressions</p>
                            <p className="font-medium">{post.impressions.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Reach</p>
                            <p className="font-medium">{post.reach.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Engagement</p>
                            <p className="font-medium">{post.engagement}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Link Clicks</p>
                            <p className="font-medium">{post.clicks}</p>
                          </div>
                        </div>

                        {selectedPost === post.id && (
                          <div className="mt-3 pt-3 border-t border-gray-200">
                            <div className="flex items-center gap-6 text-sm">
                              <span className="flex items-center gap-1">
                                <Heart className="w-4 h-4 text-red-500" />
                                {post.likes} likes
                              </span>
                              <span className="flex items-center gap-1">
                                <MessageSquare className="w-4 h-4 text-blue-500" />
                                {post.comments} comments
                              </span>
                              <span className="flex items-center gap-1">
                                <Download className="w-4 h-4 text-purple-500" />
                                {post.saves} saves
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Insights Summary */}
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <h4 className="font-medium text-green-900 mb-2">
                  <Sparkles className="w-4 h-4 inline mr-1" />
                  AI Recommendation Based on Insights:
                </h4>
                <p className="text-sm text-green-800 mb-2">
                  Your Quiz Night posts generate 35% more engagement than other content types. 
                  Consider increasing quiz frequency to twice weekly.
                </p>
                <p className="text-sm text-green-700">
                  <strong>Optimal posting time:</strong> Tuesday at 3pm (4 hours before event) drives 
                  the most link clicks and table bookings.
                </p>
              </div>
            </div>
          </div>

          {/* Audience Insights */}
          <div className="space-y-6">
            {/* Peak Times */}
            <div className="card">
              <h3 className="font-semibold mb-4">
                <Clock className="w-4 h-4 inline mr-1" />
                Best Times to Post
              </h3>
              <div className="space-y-2">
                {audienceInsights.peakTimes.slice(0, 5).map((time) => (
                  <div key={`${time.day}-${time.time}`} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{time.day}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{time.time}</span>
                      <div className="w-20 bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full"
                          style={{ width: `${time.activity}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-gray-200">
                <p className="text-xs text-gray-600">
                  Your audience is most active when planning their evening activities
                </p>
              </div>
            </div>

            {/* Location Demographics */}
            <div className="card">
              <h3 className="font-semibold mb-4">
                <Users className="w-4 h-4 inline mr-1" />
                Audience Locations
              </h3>
              <div className="space-y-3">
                {audienceInsights.topLocations.map((location) => (
                  <div key={location.name}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-600">{location.name}</span>
                      <span className="font-medium">{location.percentage}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-gradient-to-r from-purple-600 to-pink-500 h-2 rounded-full"
                        style={{ width: `${location.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-gray-200">
                <p className="text-xs text-gray-600">
                  45% of your audience is within 10-minute walk
                </p>
              </div>
            </div>

            {/* Age Demographics */}
            <div className="card">
              <h3 className="font-semibold mb-4">
                <PieChart className="w-4 h-4 inline mr-1" />
                Age Groups
              </h3>
              <div className="space-y-2">
                {audienceInsights.ageGroups.map((group) => (
                  <div key={group.range} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{group.range}</span>
                    <span className="font-medium">{group.percentage}%</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-gray-200">
                <p className="text-xs text-gray-600">
                  Primary audience: Young professionals (25-44)
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Value for Hospitality */}
        <div className="mt-8 card bg-gradient-to-br from-blue-50 to-purple-50 border-blue-200">
          <h3 className="font-semibold text-lg mb-4">How These Insights Drive Revenue:</h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div>
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mb-2">
                <Calendar className="w-5 h-5 text-blue-600" />
              </div>
              <h4 className="font-medium mb-1">Optimize Event Timing</h4>
              <p className="text-sm text-gray-700">
                Data shows Tuesday quiz nights outperform Wednesday by 40%. Adjust your schedule based on real customer behavior.
              </p>
            </div>
            <div>
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center mb-2">
                <TrendingUp className="w-5 h-5 text-purple-600" />
              </div>
              <h4 className="font-medium mb-1">Target Local Customers</h4>
              <p className="text-sm text-gray-700">
                45% of engagement comes from within 1km. Focus promotions on nearby office workers for lunch and after-work crowds.
              </p>
            </div>
            <div>
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mb-2">
                <BarChart3 className="w-5 h-5 text-green-600" />
              </div>
              <h4 className="font-medium mb-1">Measure ROI</h4>
              <p className="text-sm text-gray-700">
                Track which posts drive table bookings. Happy Hour posts with 89 clicks correlate to 25% increase in Friday revenue.
              </p>
            </div>
          </div>
        </div>

        {/* Actionable Insights */}
        <div className="mt-6 card bg-yellow-50 border-yellow-200">
          <h3 className="font-semibold text-yellow-900 mb-3">
            <Sparkles className="w-4 h-4 inline mr-1" />
            Actionable Insights for The Anchor Pub:
          </h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <ArrowUp className="w-4 h-4 text-green-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Post at 3pm for evening events</p>
                  <p className="text-xs text-gray-600">Your audience plans their evening 4-5 hours ahead</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <ArrowUp className="w-4 h-4 text-green-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Use more quiz-related content</p>
                  <p className="text-xs text-gray-600">35% higher engagement than food posts</p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <ArrowUp className="w-4 h-4 text-green-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Target London Bridge workers</p>
                  <p className="text-xs text-gray-600">45% of your audience is from this area</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <ArrowUp className="w-4 h-4 text-green-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Focus on 25-44 age group</p>
                  <p className="text-xs text-gray-600">65% of engagement from young professionals</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Export Options */}
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Insights powered by instagram_business_manage_insights API
          </p>
          <div className="flex gap-2">
            <button className="btn-ghost text-sm">
              <Filter className="w-4 h-4 mr-1" />
              Filter
            </button>
            <button className="btn-secondary text-sm">
              <Download className="w-4 h-4 mr-1" />
              Export Report
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}