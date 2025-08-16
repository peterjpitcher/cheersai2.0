"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Instagram, Check, Loader2, ChevronLeft } from "lucide-react";
import Link from "next/link";

// Demo page for App Review screencast
export default function ConnectionsDemoPage() {
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [showOAuth, setShowOAuth] = useState(false);

  const handleConnect = () => {
    setConnecting(true);
    setShowOAuth(true);
    
    // Simulate OAuth redirect
    setTimeout(() => {
      setShowOAuth(false);
      setConnecting(false);
      setConnected(true);
    }, 3000);
  };

  // Simulate OAuth screen
  if (showOAuth) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-purple-600 to-pink-500 rounded-full mx-auto mb-4 flex items-center justify-center">
              <Instagram className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Connect to Instagram</h2>
            <p className="text-gray-600">Authorizing CheersAI to access your Instagram Business account...</p>
          </div>
          
          <div className="space-y-4">
            <div className="border rounded-lg p-4">
              <p className="font-semibold mb-2">CheersAI will receive:</p>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Your Instagram Business account ID and username</li>
                <li>• Permission to publish content</li>
                <li>• Access to insights and analytics</li>
              </ul>
            </div>
            
            <div className="flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="ml-2">Redirecting to Instagram...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/settings" className="btn-ghost">
                <ChevronLeft className="w-4 h-4" />
              </Link>
              <div>
                <h1 className="text-2xl font-heading font-bold">Social Connections</h1>
                <p className="text-sm text-text-secondary">Demo Mode - For App Review</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-yellow-800">
            <strong>Demo Mode:</strong> This is a demonstration for Instagram App Review. 
            In production, this connects to real Instagram Business accounts.
          </p>
        </div>

        <div className="space-y-4">
          {/* Instagram Connection Card */}
          <div className="card">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-purple-600 to-pink-500 rounded-full flex items-center justify-center">
                  <Instagram className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">Instagram Business</h3>
                  <p className="text-sm text-text-secondary mb-3">
                    Connect your Instagram Business account to publish content
                  </p>
                  
                  {connected && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-3">
                      <div className="flex items-center gap-3">
                        <img 
                          src="https://via.placeholder.com/40" 
                          alt="Profile"
                          className="w-10 h-10 rounded-full"
                        />
                        <div>
                          <p className="font-medium">@theanchorpub</p>
                          <p className="text-sm text-gray-600">Business Account • 1,234 followers</p>
                        </div>
                        <Check className="w-5 h-5 text-green-600 ml-auto" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              <div>
                {connected ? (
                  <button 
                    onClick={() => setConnected(false)}
                    className="btn-ghost text-error"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={handleConnect}
                    disabled={connecting}
                    className="btn-primary"
                  >
                    {connecting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      "Connect"
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Where Account Info Is Displayed */}
          {connected && (
            <div className="card bg-blue-50 border-blue-200">
              <h4 className="font-semibold mb-3">Where Instagram Info Is Displayed:</h4>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-blue-600">1.</span>
                  <div>
                    <strong>This page:</strong> Shows username (@theanchorpub), profile picture, and follower count
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600">2.</span>
                  <div>
                    <strong>Dashboard:</strong> Connected accounts widget displays Instagram username and status
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600">3.</span>
                  <div>
                    <strong>Campaign Creation:</strong> Account selector shows username for choosing publish destination
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600">4.</span>
                  <div>
                    <strong>Analytics:</strong> Profile info shown at top of Instagram performance metrics
                  </div>
                </li>
              </ul>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}