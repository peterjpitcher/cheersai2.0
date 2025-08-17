"use client";

import { useState, useEffect } from "react";
import { 
  Calendar, Clock, Image as ImageIcon, ChevronRight, 
  Instagram, Facebook, MapPin, Sparkles, Check, 
  Loader2, Eye, Send, Plus, X, AlertCircle
} from "lucide-react";
import Link from "next/link";

// Demo page for instagram_business_content_publish App Review
export default function PublishDemoPage() {
  const [step, setStep] = useState<"create" | "schedule" | "review" | "publishing" | "published">("create");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [postContent, setPostContent] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);

  // Sample images for demo
  const demoImages = [
    { id: 1, url: "/api/placeholder/400/400", name: "Quiz Night Poster" },
    { id: 2, url: "/api/placeholder/400/400", name: "Happy Hour Special" },
    { id: 3, url: "/api/placeholder/400/400", name: "Live Music Event" },
  ];

  // Auto-generate content
  const generateContent = () => {
    setGenerating(true);
    setTimeout(() => {
      setPostContent(
        "🎤 QUIZ NIGHT TONIGHT! 🧠\n\n" +
        "Join us at The Anchor Pub for our legendary Tuesday Quiz Night!\n\n" +
        "🕐 Starts at 8pm\n" +
        "🏆 £100 cash prize for winners\n" +
        "🍺 Happy hour until 9pm\n" +
        "🍕 2-for-1 pizzas all evening\n\n" +
        "Book your table: 020 7234 5678\n\n" +
        "#QuizNight #TheAnchorPub #LondonPubs #TuesdayTrivia #PubQuiz"
      );
      setGenerating(false);
    }, 1500);
  };

  // Auto-progress for demo
  useEffect(() => {
    if (step === "publishing") {
      setTimeout(() => setStep("published"), 3000);
    }
  }, [step]);

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(platform)
        ? prev.filter(p => p !== platform)
        : [...prev, platform]
    );
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-heading font-bold">Content Publishing Demo</h1>
              <p className="text-sm text-text-secondary">instagram_business_content_publish - App Review</p>
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
            <li>1. This demo shows how hospitality businesses create and publish content to Instagram</li>
            <li>2. Watch the AI-assisted content generation for pub promotions</li>
            <li>3. See how venues schedule posts for optimal engagement times</li>
            <li>4. Observe the publishing process and confirmation</li>
          </ol>
        </div>
      </div>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {["Create", "Schedule", "Review", "Publish"].map((label, index) => {
              const steps = ["create", "schedule", "review", "publishing"];
              const isActive = steps.indexOf(step) >= index || step === "published";
              const isComplete = steps.indexOf(step) > index || step === "published";
              
              return (
                <div key={label} className="flex items-center flex-1">
                  <div className="flex items-center">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                      isActive ? "bg-primary text-white" : "bg-gray-200 text-gray-400"
                    }`}>
                      {isComplete ? <Check className="w-5 h-5" /> : index + 1}
                    </div>
                    <span className={`ml-2 text-sm ${isActive ? "text-primary font-medium" : "text-gray-400"}`}>
                      {label}
                    </span>
                  </div>
                  {index < 3 && (
                    <div className={`flex-1 h-1 mx-4 ${isComplete ? "bg-primary" : "bg-gray-200"}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Step Content */}
        {step === "create" && (
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Content Creation */}
            <div className="card">
              <h2 className="text-xl font-semibold mb-4">Create Your Post</h2>
              
              {/* Campaign Context */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                <p className="text-sm font-medium text-blue-900">Campaign: Tuesday Quiz Night</p>
                <p className="text-xs text-blue-700">Event Date: Tonight at 8pm</p>
              </div>

              {/* AI Generate Button */}
              <button
                onClick={generateContent}
                disabled={generating}
                className="btn-secondary w-full mb-4 flex items-center justify-center"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    AI is writing your post...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate Content with AI
                  </>
                )}
              </button>

              {/* Content Editor */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Post Content</label>
                  <textarea
                    value={postContent}
                    onChange={(e) => setPostContent(e.target.value)}
                    className="input-field min-h-[200px] font-mono text-sm"
                    placeholder="Write your post or use AI to generate..."
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {postContent.length}/2200 characters
                  </p>
                </div>

                {/* Image Selection */}
                <div>
                  <label className="block text-sm font-medium mb-2">
                    <ImageIcon className="w-4 h-4 inline mr-1" />
                    Select Image
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {demoImages.map((img) => (
                      <button
                        key={img.id}
                        onClick={() => setSelectedImage(img.id)}
                        className={`relative aspect-square rounded-lg overflow-hidden border-2 ${
                          selectedImage === img.id
                            ? "border-primary ring-2 ring-primary/20"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <div className="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                          <ImageIcon className="w-8 h-8 text-gray-400" />
                        </div>
                        {selectedImage === img.id && (
                          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                            <Check className="w-6 h-6 text-primary" />
                          </div>
                        )}
                        <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1">
                          {img.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Platform Selection */}
            <div className="card">
              <h2 className="text-xl font-semibold mb-4">Select Publishing Platforms</h2>
              
              <div className="space-y-3">
                {/* Instagram Business */}
                <button
                  onClick={() => togglePlatform("instagram")}
                  className={`w-full p-4 rounded-lg border-2 transition-all ${
                    selectedPlatforms.includes("instagram")
                      ? "border-purple-500 bg-purple-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-pink-500 rounded-lg flex items-center justify-center">
                        <Instagram className="w-6 h-6 text-white" />
                      </div>
                      <div className="text-left">
                        <p className="font-medium">Instagram Business</p>
                        <p className="text-sm text-gray-600">@theanchorpub</p>
                      </div>
                    </div>
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                      selectedPlatforms.includes("instagram")
                        ? "border-purple-500 bg-purple-500"
                        : "border-gray-300"
                    }`}>
                      {selectedPlatforms.includes("instagram") && (
                        <Check className="w-4 h-4 text-white" />
                      )}
                    </div>
                  </div>
                  {selectedPlatforms.includes("instagram") && (
                    <div className="mt-3 pt-3 border-t border-purple-200">
                      <p className="text-xs text-purple-700">
                        Will publish to Instagram feed using instagram_business_content_publish permission
                      </p>
                    </div>
                  )}
                </button>

                {/* Facebook Page */}
                <button
                  onClick={() => togglePlatform("facebook")}
                  className={`w-full p-4 rounded-lg border-2 transition-all ${
                    selectedPlatforms.includes("facebook")
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                        <Facebook className="w-6 h-6 text-white" />
                      </div>
                      <div className="text-left">
                        <p className="font-medium">Facebook Page</p>
                        <p className="text-sm text-gray-600">The Anchor Pub London</p>
                      </div>
                    </div>
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                      selectedPlatforms.includes("facebook")
                        ? "border-blue-500 bg-blue-500"
                        : "border-gray-300"
                    }`}>
                      {selectedPlatforms.includes("facebook") && (
                        <Check className="w-4 h-4 text-white" />
                      )}
                    </div>
                  </div>
                </button>

                {/* Google My Business (Coming Soon) */}
                <div className="w-full p-4 rounded-lg border-2 border-gray-200 opacity-50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
                        <MapPin className="w-6 h-6 text-white" />
                      </div>
                      <div className="text-left">
                        <p className="font-medium">Google My Business</p>
                        <p className="text-sm text-gray-600">Coming Soon</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Value Proposition */}
              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <h3 className="font-medium text-green-900 mb-2">Why This Matters:</h3>
                <ul className="text-sm text-green-800 space-y-1">
                  <li>• Reach customers where they are most active</li>
                  <li>• Consistent messaging across all platforms</li>
                  <li>• Save hours by posting to multiple platforms at once</li>
                  <li>• Perfect for busy pub owners during service hours</li>
                </ul>
              </div>

              <button
                onClick={() => setStep("schedule")}
                disabled={!postContent || selectedPlatforms.length === 0}
                className="btn-primary w-full mt-6"
              >
                Continue to Scheduling
                <ChevronRight className="w-4 h-4 ml-2" />
              </button>
            </div>
          </div>
        )}

        {step === "schedule" && (
          <div className="max-w-3xl mx-auto">
            <div className="card">
              <h2 className="text-xl font-semibold mb-4">Schedule Your Post</h2>
              
              {/* Optimal Times */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <h3 className="font-medium text-blue-900 mb-2">
                  <Clock className="w-4 h-4 inline mr-1" />
                  Recommended Times for Maximum Engagement
                </h3>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {["3:00 PM", "5:30 PM", "7:00 PM"].map((time) => (
                    <button
                      key={time}
                      onClick={() => setScheduledTime(time)}
                      className={`py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                        scheduledTime === time
                          ? "bg-blue-600 text-white"
                          : "bg-white text-blue-700 border border-blue-300 hover:bg-blue-100"
                      }`}
                    >
                      {time}
                      {time === "5:30 PM" && (
                        <span className="block text-xs mt-1">Best time</span>
                      )}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-blue-700 mt-3">
                  Based on your audience's activity patterns and hospitality industry best practices
                </p>
              </div>

              {/* Manual Time Selection */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    <Calendar className="w-4 h-4 inline mr-1" />
                    Select Date and Time
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="date"
                      className="input-field"
                      defaultValue={new Date().toISOString().split('T')[0]}
                    />
                    <input
                      type="time"
                      className="input-field"
                      value={scheduledTime ? scheduledTime.replace(" PM", "").replace(" AM", "") : ""}
                      onChange={(e) => setScheduledTime(e.target.value)}
                    />
                  </div>
                </div>

                {/* Posting Strategy */}
                <div className="p-4 bg-gray-50 rounded-lg">
                  <h4 className="font-medium mb-2">Multi-Platform Strategy:</h4>
                  <ul className="text-sm text-gray-700 space-y-1">
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-600 mt-0.5" />
                      <span>Instagram: Posts at scheduled time with optimized hashtags</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-600 mt-0.5" />
                      <span>Facebook: Simultaneous posting with location tags</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Clock className="w-4 h-4 text-blue-600 mt-0.5" />
                      <span>All platforms respect timezone settings (London/GMT)</span>
                    </li>
                  </ul>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setStep("create")}
                  className="btn-ghost flex-1"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep("review")}
                  disabled={!scheduledTime}
                  className="btn-primary flex-1"
                >
                  Review Post
                  <ChevronRight className="w-4 h-4 ml-2" />
                </button>
              </div>
            </div>
          </div>
        )}

        {step === "review" && (
          <div className="max-w-4xl mx-auto">
            <div className="card">
              <h2 className="text-xl font-semibold mb-4">Review and Publish</h2>
              
              {/* Preview Grid */}
              <div className="grid md:grid-cols-2 gap-6 mb-6">
                {/* Instagram Preview */}
                {selectedPlatforms.includes("instagram") && (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="bg-gradient-to-r from-purple-600 to-pink-500 text-white p-3">
                      <div className="flex items-center gap-2">
                        <Instagram className="w-5 h-5" />
                        <span className="font-medium">Instagram Preview</span>
                      </div>
                    </div>
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 bg-gradient-to-br from-purple-600 to-pink-500 rounded-full"></div>
                        <div>
                          <p className="font-medium text-sm">theanchorpub</p>
                          <p className="text-xs text-gray-500">London Bridge</p>
                        </div>
                      </div>
                      <div className="aspect-square bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg mb-3 flex items-center justify-center">
                        <ImageIcon className="w-16 h-16 text-gray-400" />
                      </div>
                      <div className="text-sm whitespace-pre-wrap">{postContent}</div>
                    </div>
                  </div>
                )}

                {/* Facebook Preview */}
                {selectedPlatforms.includes("facebook") && (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="bg-blue-600 text-white p-3">
                      <div className="flex items-center gap-2">
                        <Facebook className="w-5 h-5" />
                        <span className="font-medium">Facebook Preview</span>
                      </div>
                    </div>
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 bg-blue-600 rounded-full"></div>
                        <div>
                          <p className="font-medium text-sm">The Anchor Pub London</p>
                          <p className="text-xs text-gray-500">{scheduledTime || "Now"}</p>
                        </div>
                      </div>
                      <div className="text-sm whitespace-pre-wrap mb-3">{postContent}</div>
                      <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg flex items-center justify-center">
                        <ImageIcon className="w-16 h-16 text-gray-400" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Publishing Details */}
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <h3 className="font-medium mb-3">Publishing Details:</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Scheduled Time:</span>
                    <span className="font-medium">{scheduledTime || "Immediately"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Platforms:</span>
                    <span className="font-medium">{selectedPlatforms.join(", ")}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Campaign:</span>
                    <span className="font-medium">Tuesday Quiz Night</span>
                  </div>
                </div>
              </div>

              {/* Permission Usage Notice */}
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
                <h3 className="font-medium text-purple-900 mb-2">
                  <AlertCircle className="w-4 h-4 inline mr-1" />
                  How We Use instagram_business_content_publish:
                </h3>
                <ul className="text-sm text-purple-800 space-y-1">
                  <li>• Create organic feed posts on your Instagram Business account</li>
                  <li>• Include images and captions you've approved</li>
                  <li>• Post at the exact time you've scheduled</li>
                  <li>• Track post performance after publishing</li>
                </ul>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep("schedule")}
                  className="btn-ghost flex-1"
                >
                  Back to Scheduling
                </button>
                <button
                  onClick={() => setStep("publishing")}
                  className="btn-primary flex-1"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Publish to {selectedPlatforms.length} Platform{selectedPlatforms.length > 1 ? "s" : ""}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === "publishing" && (
          <div className="max-w-lg mx-auto">
            <div className="card text-center py-12">
              <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">Publishing Your Content...</h2>
              <p className="text-gray-600 mb-6">
                We're posting to your selected platforms
              </p>
              <div className="space-y-3 max-w-xs mx-auto">
                {selectedPlatforms.includes("instagram") && (
                  <div className="flex items-center gap-3 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
                    <span>Publishing to Instagram Business...</span>
                  </div>
                )}
                {selectedPlatforms.includes("facebook") && (
                  <div className="flex items-center gap-3 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    <span>Publishing to Facebook Page...</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {step === "published" && (
          <div className="max-w-lg mx-auto">
            <div className="card text-center py-12">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-semibold mb-2">Successfully Published!</h2>
              <p className="text-gray-600 mb-6">
                Your content has been posted to all selected platforms
              </p>
              
              {/* Published Links */}
              <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
                <h3 className="font-medium mb-3">View Your Posts:</h3>
                <div className="space-y-2">
                  {selectedPlatforms.includes("instagram") && (
                    <a href="#" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                      <Instagram className="w-4 h-4" />
                      View on Instagram
                      <ChevronRight className="w-3 h-3" />
                    </a>
                  )}
                  {selectedPlatforms.includes("facebook") && (
                    <a href="#" className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                      <Facebook className="w-4 h-4" />
                      View on Facebook
                      <ChevronRight className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>

              {/* Next Steps */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-left">
                <h3 className="font-medium text-blue-900 mb-2">What Happens Next:</h3>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• Monitor engagement in Analytics dashboard</li>
                  <li>• AI will suggest optimal posting times based on performance</li>
                  <li>• Schedule your next campaign to maintain consistency</li>
                  <li>• View insights to improve future content</li>
                </ul>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setStep("create")}
                  className="btn-ghost flex-1"
                >
                  Create Another Post
                </button>
                <Link href="/analytics" className="btn-primary flex-1">
                  View Analytics
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Value Summary */}
        <div className="mt-8 card bg-gradient-to-br from-purple-50 to-pink-50 border-purple-200">
          <h3 className="font-semibold text-lg mb-3">Value for Hospitality Businesses:</h3>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <h4 className="font-medium text-sm mb-1">⏱️ Time Savings</h4>
              <p className="text-xs text-gray-700">
                Post to multiple platforms in seconds instead of logging into each separately
              </p>
            </div>
            <div>
              <h4 className="font-medium text-sm mb-1">📈 Increased Reach</h4>
              <p className="text-xs text-gray-700">
                AI-optimized content and timing drives 3x more engagement
              </p>
            </div>
            <div>
              <h4 className="font-medium text-sm mb-1">🎯 Revenue Growth</h4>
              <p className="text-xs text-gray-700">
                Consistent promotion of events and specials fills tables during quiet periods
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}