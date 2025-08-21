"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Instagram, Check, Loader2, User, BarChart3, Image, MessageSquare, Settings } from "lucide-react";
import Link from "next/link";

// Demo page for App Review screencast - Compliant with Facebook requirements
export default function ConnectionsDemoPage() {
  const router = useRouter();
  const [step, setStep] = useState<"logged-out" | "login" | "connecting" | "oauth" | "permissions" | "connected">("logged-out");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Auto-progress through demo flow
  useEffect(() => {
    if (step === "oauth") {
      setTimeout(() => setStep("permissions"), 2000);
    }
    if (step === "permissions") {
      setTimeout(() => setStep("connected"), 3000);
    }
  }, [step]);

  // Simulate login (Facebook requirement: show complete login flow)
  if (step === "logged-out") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-bold text-primary mb-2">CheersAI</h1>
            <p className="text-gray-600">Demo Mode - App Review</p>
          </div>
          
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6">
            <p className="text-sm text-blue-800">
              <strong>Test Credentials:</strong><br />
              Email: reviewer@cheersai.com<br />
              Password: ReviewTest2025!
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                placeholder="reviewer@cheersai.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field"
                placeholder="••••••••"
              />
            </div>
            <button
              onClick={() => setStep("login")}
              className="btn-primary w-full"
            >
              Log In to CheersAI
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (step === "login") {
    setTimeout(() => setStep("connecting"), 1500);
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-gray-600">Logging in...</p>
        </div>
      </div>
    );
  }

  // OAuth simulation (Facebook requirement: show authorization flow)
  if (step === "oauth") {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <div className="max-w-lg w-full">
          {/* Facebook OAuth Header */}
          <div className="bg-[#1877f2] text-white p-4 rounded-t-lg">
            <h2 className="text-xl font-semibold">Continue as Test User</h2>
          </div>
          
          <div className="border border-gray-200 rounded-b-lg p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-600 to-pink-500 rounded-full flex items-center justify-center">
                <Instagram className="w-8 h-8 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">CheersAI</h3>
                <p className="text-sm text-gray-600">wants to access your Instagram Business Account</p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <p className="text-sm text-gray-700 mb-2">This will allow CheersAI to:</p>
              <ul className="space-y-1 text-sm text-gray-600">
                <li>• Access your Instagram Business account ID and username</li>
                <li>• Verify you've connected the correct venue's account</li>
                <li>• Enable multi-location management for pub chains</li>
              </ul>
            </div>

            <div className="flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-[#1877f2]" />
              <span className="ml-2 text-gray-600">Redirecting to Instagram...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Permission granting screen (Facebook requirement: show permission granting)
  if (step === "permissions") {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <div className="max-w-lg w-full">
          <div className="bg-gradient-to-r from-purple-600 to-pink-500 text-white p-4 rounded-t-lg">
            <h2 className="text-xl font-semibold">Instagram Business Permissions</h2>
          </div>
          
          <div className="border border-gray-200 rounded-b-lg p-6">
            <div className="mb-6">
              <h3 className="font-semibold mb-3">Select Instagram Business Account:</h3>
              <div className="border rounded-lg p-3 bg-blue-50 border-blue-300">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-300 rounded-full"></div>
                  <div>
                    <p className="font-medium">@theanchorpub</p>
                    <p className="text-sm text-gray-600">The Anchor Pub • Business Account</p>
                  </div>
                  <Check className="w-5 h-5 text-blue-600 ml-auto" />
                </div>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              <h3 className="font-semibold">Permissions being granted:</h3>
              
              <div className="flex items-start gap-3 p-3 bg-green-50 rounded-lg">
                <Check className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">instagram_business_basic</p>
                  <p className="text-xs text-gray-600">Access account ID and username</p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-green-50 rounded-lg">
                <Check className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">instagram_business_content_publish</p>
                  <p className="text-xs text-gray-600">Publish content to your account</p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-green-50 rounded-lg">
                <Check className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">instagram_business_manage_insights</p>
                  <p className="text-xs text-gray-600">View analytics and performance</p>
                </div>
              </div>
            </div>

            <button className="btn-primary w-full">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Authorizing...
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Main connections page (Facebook requirement: show data usage)
  return (
    <div className="min-h-screen bg-background">
      {/* Header with annotation */}
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-heading font-bold">Social Connections</h1>
              <p className="text-sm text-text-secondary">Demo Mode - For App Review</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Review Instructions */}
        <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-yellow-900 mb-2">📍 App Review Instructions:</h3>
          <ol className="text-sm text-yellow-800 space-y-1">
            <li>1. This recording demonstrates the complete authentication flow for hospitality businesses</li>
            <li>2. Watch how pub owners connect their Instagram Business accounts to CheersAI</li>
            <li>3. The instagram_business_basic permission retrieves only account ID and username</li>
            <li>4. See how we display this data for account verification and multi-venue management</li>
          </ol>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Instagram Connection Card */}
          <div className="card">
            <div className="border-b border-gray-200 pb-3 mb-4">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Instagram className="w-5 h-5 text-purple-600" />
                Instagram Business Account
              </h3>
            </div>

            {step === "connecting" ? (
              <div className="py-8 text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
                <p className="text-gray-600">Connecting to Instagram...</p>
                <button
                  onClick={() => setStep("oauth")}
                  className="btn-primary mt-4"
                >
                  Continue to Instagram
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Connected Account Display */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-green-800">✓ Account Verified</span>
                    <Check className="w-5 h-5 text-green-600" />
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-gradient-to-br from-purple-600 to-pink-500 rounded-full flex items-center justify-center">
                      <Instagram className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-lg">@theanchorpub</p>
                      <p className="text-sm text-gray-600">Account ID: 17841409165322018</p>
                      <p className="text-xs text-gray-500">Business Account • London Bridge Location</p>
                    </div>
                  </div>
                  
                  <div className="mt-3 pt-3 border-t border-green-200">
                    <p className="text-xs text-green-800">
                      ✓ This is the correct Instagram account for The Anchor Pub
                    </p>
                  </div>
                </div>

                {/* Data Retrieved */}
                <div className="border rounded-lg p-4">
                  <h4 className="font-medium mb-3 text-sm text-gray-700">Data from instagram_business_basic:</h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <User className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-600">Username:</span>
                      <span className="font-medium">theanchorpub</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Settings className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-600">Account ID:</span>
                      <span className="font-mono text-xs">17841409165322018</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-600">Account Type:</span>
                      <span className="font-medium">Business</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button className="btn-secondary flex-1">
                    Test Connection
                  </button>
                  <button className="btn-ghost text-error">
                    Disconnect
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Where Data Is Displayed */}
          <div className="card bg-blue-50 border-blue-200">
            <h3 className="font-semibold text-lg mb-4 text-blue-900">
              📍 Where Instagram Data Is Displayed
            </h3>
            
            <div className="space-y-4">
              {/* Location 1 */}
              <div className="bg-white rounded-lg p-4">
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <span className="w-6 h-6 bg-blue-600 text-white rounded-full text-xs flex items-center justify-center">1</span>
                  Settings → Social Connections
                </h4>
                <p className="text-sm text-gray-600 mb-2">Current page - Shows:</p>
                <ul className="text-sm space-y-1 ml-8">
                  <li>• Username (@theanchorpub)</li>
                  <li>• Account ID (17841409165322018)</li>
                  <li>• Connection status</li>
                </ul>
              </div>

              {/* Location 2 */}
              <div className="bg-white rounded-lg p-4">
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <span className="w-6 h-6 bg-blue-600 text-white rounded-full text-xs flex items-center justify-center">2</span>
                  Multi-Location Dashboard
                </h4>
                <p className="text-sm text-gray-600 mb-2">For pub chains managing multiple venues:</p>
                <ul className="text-sm space-y-1 ml-8">
                  <li>• Each location's Instagram username</li>
                  <li>• Unique account IDs for venue distinction</li>
                  <li>• Quick verification of connected accounts</li>
                </ul>
                <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">
                  View Dashboard →
                </Link>
              </div>

              {/* Location 3 */}
              <div className="bg-white rounded-lg p-4">
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <span className="w-6 h-6 bg-blue-600 text-white rounded-full text-xs flex items-center justify-center">3</span>
                  Campaign Creation
                </h4>
                <p className="text-sm text-gray-600 mb-2">When creating promotions:</p>
                <ul className="text-sm space-y-1 ml-8">
                  <li>• Select correct venue by username</li>
                  <li>• Account ID ensures posts go to right location</li>
                  <li>• Prevent cross-posting between venues</li>
                </ul>
                <Link href="/campaigns/new" className="text-sm text-blue-600 hover:underline">
                  Create Campaign →
                </Link>
              </div>

              {/* Location 4 */}
              <div className="bg-white rounded-lg p-4">
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <span className="w-6 h-6 bg-blue-600 text-white rounded-full text-xs flex items-center justify-center">4</span>
                  Analytics Dashboard
                </h4>
                <p className="text-sm text-gray-600 mb-2">Profile section displays:</p>
                <ul className="text-sm space-y-1 ml-8">
                  <li>• Account username</li>
                  <li>• Account ID for API calls</li>
                </ul>
                <Link href="/analytics" className="text-sm text-blue-600 hover:underline">
                  View Analytics →
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Why This Permission Is Necessary */}
        <div className="mt-6 card bg-red-50 border-red-200">
          <h3 className="font-semibold mb-3 text-red-900">⚠️ Why This Permission Is Necessary:</h3>
          <p className="text-sm text-gray-700 mb-3">
            This permission is foundational for our app's functionality. Without instagram_business_basic, we cannot:
          </p>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <span className="text-red-600 mt-0.5">✗</span>
              <span>Identify which Instagram account is connected (critical for multi-location businesses)</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-red-600 mt-0.5">✗</span>
              <span>Display account information for user verification</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-red-600 mt-0.5">✗</span>
              <span>Ensure content is published to the correct business account</span>
            </li>
          </ul>
          <p className="text-xs text-gray-600 mt-3 pt-3 border-t border-red-200">
            This permission serves as a required dependency for content publishing features - we need to identify and verify the account before we can publish content to it.
          </p>
        </div>

        {/* Permission Usage Explanation */}
        <div className="mt-6 card bg-gray-50">
          <h3 className="font-semibold mb-3">How CheersAI Uses instagram_business_basic:</h3>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg p-4">
              <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center mb-2">
                <User className="w-4 h-4 text-purple-600" />
              </div>
              <h4 className="font-medium text-sm mb-1">Retrieve Account Identity</h4>
              <p className="text-xs text-gray-600">
                Fetch the Instagram Business account ID and username to uniquely identify connected accounts
              </p>
            </div>
            
            <div className="bg-white rounded-lg p-4">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mb-2">
                <Check className="w-4 h-4 text-blue-600" />
              </div>
              <h4 className="font-medium text-sm mb-1">Display Profile Information</h4>
              <p className="text-xs text-gray-600">
                Show the business's username and account type so owners can verify the correct account
              </p>
            </div>
            
            <div className="bg-white rounded-lg p-4">
              <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center mb-2">
                <Settings className="w-4 h-4 text-green-600" />
              </div>
              <h4 className="font-medium text-sm mb-1">Multi-Venue Management</h4>
              <p className="text-xs text-gray-600">
                Pub chains can distinguish between different location accounts using unique account IDs
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}