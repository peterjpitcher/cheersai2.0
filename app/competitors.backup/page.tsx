"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ChevronLeft, Plus, TrendingUp, TrendingDown,
  Users, Heart, MessageCircle, Share2, Eye,
  Facebook, Instagram, Twitter, MapPin,
  BarChart3, Calendar, Loader2, Search
} from "lucide-react";
import Link from "next/link";
import { Line, Bar } from "react-chartjs-2";

interface Competitor {
  id: string;
  name: string;
  website?: string;
  social_profiles: {
    facebook?: string;
    instagram?: string;
    twitter?: string;
    google?: string;
  };
  metrics: {
    followers: number;
    engagement_rate: number;
    avg_posts_per_week: number;
    last_post_date?: string;
  };
  category: string;
  location?: string;
}

interface CompetitorPost {
  id: string;
  competitor_id: string;
  platform: string;
  content: string;
  likes: number;
  comments: number;
  shares: number;
  posted_at: string;
  url?: string;
}

export default function CompetitorsPage() {
  const router = useRouter();
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [selectedCompetitor, setSelectedCompetitor] = useState<Competitor | null>(null);
  const [competitorPosts, setCompetitorPosts] = useState<CompetitorPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [timeRange, setTimeRange] = useState("7");

  useEffect(() => {
    fetchCompetitors();
  }, []);

  useEffect(() => {
    if (selectedCompetitor) {
      fetchCompetitorPosts(selectedCompetitor.id);
    }
  }, [selectedCompetitor]);

  const fetchCompetitors = async () => {
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/auth/login");
      return;
    }

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) return;

    // Mock data for demonstration
    const mockCompetitors: Competitor[] = [
      {
        id: "1",
        name: "The Red Lion",
        website: "https://redlionpub.co.uk",
        social_profiles: {
          facebook: "redlionpub",
          instagram: "redlionpub",
          twitter: "redlionpub"
        },
        metrics: {
          followers: 3250,
          engagement_rate: 4.2,
          avg_posts_per_week: 5,
          last_post_date: new Date().toISOString()
        },
        category: "Traditional Pub",
        location: "Camden, London"
      },
      {
        id: "2",
        name: "The Craft House",
        website: "https://crafthouse.co.uk",
        social_profiles: {
          facebook: "crafthouseuk",
          instagram: "crafthouseuk",
          twitter: "crafthouseuk"
        },
        metrics: {
          followers: 5420,
          engagement_rate: 6.8,
          avg_posts_per_week: 8,
          last_post_date: new Date().toISOString()
        },
        category: "Craft Beer Bar",
        location: "Shoreditch, London"
      },
      {
        id: "3",
        name: "The Garden Arms",
        website: "https://gardenarms.co.uk",
        social_profiles: {
          facebook: "gardenarms",
          instagram: "gardenarmspub"
        },
        metrics: {
          followers: 2100,
          engagement_rate: 3.5,
          avg_posts_per_week: 3,
          last_post_date: new Date(Date.now() - 86400000).toISOString()
        },
        category: "Gastropub",
        location: "Richmond, London"
      }
    ];

    setCompetitors(mockCompetitors);
    setLoading(false);
  };

  const fetchCompetitorPosts = async (competitorId: string) => {
    // Mock posts data
    const mockPosts: CompetitorPost[] = [
      {
        id: "1",
        competitor_id: competitorId,
        platform: "facebook",
        content: "Join us this Friday for live music! 🎵 Our weekly jazz night starts at 8pm.",
        likes: 145,
        comments: 23,
        shares: 12,
        posted_at: new Date(Date.now() - 86400000).toISOString()
      },
      {
        id: "2",
        competitor_id: competitorId,
        platform: "instagram",
        content: "New cocktail menu launching tomorrow! 🍹 Which one will you try first?",
        likes: 287,
        comments: 45,
        shares: 8,
        posted_at: new Date(Date.now() - 172800000).toISOString()
      },
      {
        id: "3",
        competitor_id: competitorId,
        platform: "twitter",
        content: "Happy hour extended until 8pm today! See you soon 🍺",
        likes: 67,
        comments: 5,
        shares: 3,
        posted_at: new Date(Date.now() - 259200000).toISOString()
      }
    ];

    setCompetitorPosts(mockPosts);
  };

  const handleAddCompetitor = async (e: React.FormEvent) => {
    e.preventDefault();
    // Implementation for adding competitor
    setShowAddForm(false);
  };

  const calculateEngagement = (post: CompetitorPost) => {
    return post.likes + post.comments + post.shares;
  };

  const getTopPerformingPost = () => {
    if (competitorPosts.length === 0) return null;
    return competitorPosts.reduce((prev, current) => 
      calculateEngagement(prev) > calculateEngagement(current) ? prev : current
    );
  };

  // Chart data
  const engagementChartData = {
    labels: competitorPosts.map(p => 
      new Date(p.posted_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    ).reverse(),
    datasets: [
      {
        label: 'Engagement',
        data: competitorPosts.map(p => calculateEngagement(p)).reverse(),
        borderColor: 'rgb(234, 88, 12)',
        backgroundColor: 'rgba(234, 88, 12, 0.1)',
        tension: 0.4
      }
    ]
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

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
                <h1 className="text-2xl font-heading font-bold">Competitor Analysis</h1>
                <p className="text-sm text-text-secondary">
                  Track and analyze competitor social media activity
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowAddForm(true)}
              className="btn-primary"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Competitor
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Competitors List */}
          <div className="lg:col-span-1 space-y-4">
            <div className="card">
              <h3 className="font-semibold mb-4">Tracked Competitors</h3>
              
              {/* Search */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search competitors..."
                  className="input-field pl-9 py-2 text-sm"
                />
              </div>

              {/* List */}
              <div className="space-y-2">
                {competitors.map((competitor) => (
                  <button
                    key={competitor.id}
                    onClick={() => setSelectedCompetitor(competitor)}
                    className={`w-full text-left p-3 rounded-medium transition-colors ${
                      selectedCompetitor?.id === competitor.id
                        ? 'bg-primary/10 border border-primary/20'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">{competitor.name}</p>
                        <p className="text-xs text-text-secondary">
                          {competitor.location}
                        </p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-xs flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {competitor.metrics.followers.toLocaleString()}
                          </span>
                          <span className="text-xs flex items-center gap-1">
                            <Heart className="w-3 h-3" />
                            {competitor.metrics.engagement_rate}%
                          </span>
                        </div>
                      </div>
                      {competitor.metrics.engagement_rate > 5 ? (
                        <TrendingUp className="w-4 h-4 text-success" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-warning" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Stats */}
            <div className="card">
              <h4 className="font-semibold mb-3">Market Overview</h4>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-secondary">Avg. Followers</span>
                  <span className="font-semibold">
                    {Math.round(competitors.reduce((sum, c) => sum + c.metrics.followers, 0) / competitors.length).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-secondary">Avg. Engagement</span>
                  <span className="font-semibold">
                    {(competitors.reduce((sum, c) => sum + c.metrics.engagement_rate, 0) / competitors.length).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-secondary">Avg. Posts/Week</span>
                  <span className="font-semibold">
                    {Math.round(competitors.reduce((sum, c) => sum + c.metrics.avg_posts_per_week, 0) / competitors.length)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Analysis Panel */}
          <div className="lg:col-span-2">
            {selectedCompetitor ? (
              <div className="space-y-6">
                {/* Competitor Header */}
                <div className="card">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-xl font-semibold">{selectedCompetitor.name}</h3>
                      <p className="text-sm text-text-secondary">{selectedCompetitor.category}</p>
                      {selectedCompetitor.website && (
                        <a 
                          href={selectedCompetitor.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline mt-1 inline-block"
                        >
                          Visit website →
                        </a>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {selectedCompetitor.social_profiles.facebook && (
                        <a href={`https://facebook.com/${selectedCompetitor.social_profiles.facebook}`} target="_blank" rel="noopener noreferrer">
                          <Facebook className="w-5 h-5 text-blue-600" />
                        </a>
                      )}
                      {selectedCompetitor.social_profiles.instagram && (
                        <a href={`https://instagram.com/${selectedCompetitor.social_profiles.instagram}`} target="_blank" rel="noopener noreferrer">
                          <Instagram className="w-5 h-5 text-purple-600" />
                        </a>
                      )}
                      {selectedCompetitor.social_profiles.twitter && (
                        <a href={`https://twitter.com/${selectedCompetitor.social_profiles.twitter}`} target="_blank" rel="noopener noreferrer">
                          <Twitter className="w-5 h-5 text-black" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Metrics Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center p-3 bg-gray-50 rounded-medium">
                      <Users className="w-6 h-6 text-primary mx-auto mb-1" />
                      <p className="text-2xl font-bold">{selectedCompetitor.metrics.followers.toLocaleString()}</p>
                      <p className="text-xs text-text-secondary">Followers</p>
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded-medium">
                      <Heart className="w-6 h-6 text-red-500 mx-auto mb-1" />
                      <p className="text-2xl font-bold">{selectedCompetitor.metrics.engagement_rate}%</p>
                      <p className="text-xs text-text-secondary">Engagement</p>
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded-medium">
                      <Calendar className="w-6 h-6 text-blue-500 mx-auto mb-1" />
                      <p className="text-2xl font-bold">{selectedCompetitor.metrics.avg_posts_per_week}</p>
                      <p className="text-xs text-text-secondary">Posts/Week</p>
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded-medium">
                      <Eye className="w-6 h-6 text-green-500 mx-auto mb-1" />
                      <p className="text-2xl font-bold">
                        {Math.round(selectedCompetitor.metrics.followers * selectedCompetitor.metrics.engagement_rate / 100).toLocaleString()}
                      </p>
                      <p className="text-xs text-text-secondary">Avg. Reach</p>
                    </div>
                  </div>
                </div>

                {/* Engagement Chart */}
                <div className="card">
                  <h4 className="font-semibold mb-4">Engagement Trend</h4>
                  <div className="h-64">
                    <Line 
                      data={engagementChartData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: { display: false }
                        }
                      }}
                    />
                  </div>
                </div>

                {/* Recent Posts */}
                <div className="card">
                  <h4 className="font-semibold mb-4">Recent Posts</h4>
                  <div className="space-y-4">
                    {competitorPosts.map((post) => (
                      <div key={post.id} className="p-4 bg-gray-50 rounded-medium">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {post.platform === 'facebook' && <Facebook className="w-4 h-4 text-blue-600" />}
                            {post.platform === 'instagram' && <Instagram className="w-4 h-4 text-purple-600" />}
                            {post.platform === 'twitter' && <Twitter className="w-4 h-4 text-black" />}
                            <span className="text-xs text-text-secondary">
                              {new Date(post.posted_at).toLocaleDateString('en-GB')}
                            </span>
                          </div>
                        </div>
                        <p className="text-sm mb-3">{post.content}</p>
                        <div className="flex items-center gap-4 text-xs text-text-secondary">
                          <span className="flex items-center gap-1">
                            <Heart className="w-3 h-3" /> {post.likes}
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageCircle className="w-3 h-3" /> {post.comments}
                          </span>
                          <span className="flex items-center gap-1">
                            <Share2 className="w-3 h-3" /> {post.shares}
                          </span>
                          <span className="ml-auto font-semibold">
                            {calculateEngagement(post)} total engagements
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Top Performing Post */}
                {getTopPerformingPost() && (
                  <div className="card bg-success/10 border-success/20">
                    <h4 className="font-semibold mb-3 text-success">Top Performing Post</h4>
                    <p className="text-sm mb-3">{getTopPerformingPost()!.content}</p>
                    <p className="text-xs text-text-secondary">
                      {calculateEngagement(getTopPerformingPost()!)} total engagements
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="card text-center py-16">
                <BarChart3 className="w-16 h-16 text-text-secondary mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Select a Competitor</h3>
                <p className="text-text-secondary">
                  Choose a competitor from the list to view their analytics
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}