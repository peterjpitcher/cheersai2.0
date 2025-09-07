"use client";

import { useState } from "react";
import { MessageCircle, Mail, Phone, Users, Send, Loader2, CheckCircle, AlertCircle, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface SupportTier {
  email: boolean;
  whatsapp: boolean;
  phone: boolean;
  priority: boolean;
}

interface ContactFormProps {
  subscriptionTier: string;
  supportTier: SupportTier;
  onSubmit?: () => void;
}

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low - General question' },
  { value: 'normal', label: 'Normal - Need help' },
  { value: 'high', label: 'High - Blocking issue' },
  { value: 'urgent', label: 'Urgent - Service down' },
];

const SUPPORT_CHANNELS = {
  email: {
    icon: Mail,
    label: 'Email Support',
    description: 'Get help via email (24-48 hour response)',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 border-blue-200',
  },
  whatsapp: {
    icon: MessageCircle,
    label: 'WhatsApp Support',
    description: 'Quick help via WhatsApp (4-8 hour response)',
    color: 'text-green-600',
    bgColor: 'bg-green-50 border-green-200',
  },
  phone: {
    icon: Phone,
    label: 'Phone Support',
    description: 'Immediate assistance by phone (callback within 1 hour)',
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 border-purple-200',
  },
  community: {
    icon: Users,
    label: 'Community Forum',
    description: 'Get help from the community and other users',
    color: 'text-gray-600',
    bgColor: 'bg-gray-50 border-gray-200',
  },
};

export default function ContactForm({ subscriptionTier, supportTier, onSubmit }: ContactFormProps) {
  const [selectedChannel, setSelectedChannel] = useState<string>('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState('normal');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const availableChannels = [];
  
  // Determine available channels based on subscription tier
  if (supportTier.email) {
    availableChannels.push('email');
  }
  if (supportTier.whatsapp) {
    availableChannels.push('whatsapp');
  }
  if (supportTier.phone) {
    availableChannels.push('phone');
  }
  
  // Community forum is available for all tiers
  availableChannels.push('community');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedChannel || !subject || !message) {
      return;
    }

    setIsSubmitting(true);
    
    try {
      if (selectedChannel === 'community') {
        // For community forum, redirect to external forum or show instructions
        window.open('https://community.cheersai.co.uk', '_blank');
        setSubmitStatus('success');
      } else {
        // Submit support ticket
        const response = await fetch('/api/support/ticket', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject,
            message,
            priority,
            support_channel: selectedChannel,
            subscription_tier: subscriptionTier,
          }),
        });

        if (response.ok) {
          setSubmitStatus('success');
          setSubject('');
          setMessage('');
          setPriority('normal');
          setSelectedChannel('');
          onSubmit?.();
        } else {
          setSubmitStatus('error');
        }
      }
    } catch (error) {
      console.error('Error submitting support ticket:', error);
      setSubmitStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getTierBadgeColor = (tier: string) => {
    switch (tier) {
      case 'free':
        return 'bg-gray-100 text-gray-800';
      case 'starter':
        return 'bg-blue-100 text-blue-800';
      case 'pro':
        return 'bg-purple-100 text-purple-800';
      case 'enterprise':
        return 'bg-gold-100 text-gold-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (submitStatus === 'success') {
    return (
      <Card className="text-center py-12">
        <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
        <h3 className="text-xl font-semibold mb-2">Request Submitted!</h3>
        <p className="text-text-secondary mb-6">
          {selectedChannel === 'community' 
            ? "You've been redirected to our community forum. Join the discussion and get help from other users!"
            : `We've received your ${selectedChannel} support request and will respond according to your plan's SLA.`
          }
        </p>
        <Button 
          onClick={() => setSubmitStatus('idle')} 
          variant="secondary"
        >
          Submit Another Request
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Plan Badge */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-secondary">Your plan:</span>
        <span className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${getTierBadgeColor(subscriptionTier)}`}>
          {subscriptionTier === 'pro' ? 'Professional' : subscriptionTier}
        </span>
      </div>

      {/* Channel Selection */}
      <div className="space-y-3">
        <h3 className="font-semibold">Choose Support Channel</h3>
        <div className="grid gap-3">
          {availableChannels.map((channel) => {
            const config = SUPPORT_CHANNELS[channel as keyof typeof SUPPORT_CHANNELS];
            const Icon = config.icon;
            const isAvailable = channel === 'community' || 
              (channel === 'email' && supportTier.email) ||
              (channel === 'whatsapp' && supportTier.whatsapp) ||
              (channel === 'phone' && supportTier.phone);

            return (
              <button
                key={channel}
                type="button"
                onClick={() => setSelectedChannel(channel)}
                disabled={!isAvailable}
                className={`
                  w-full p-4 rounded-lg border-2 text-left transition-all
                  ${selectedChannel === channel 
                    ? `${config.bgColor} border-current` 
                    : 'bg-white border-border hover:border-border-hover'
                  }
                  ${!isAvailable ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                <div className="flex items-start gap-3">
                  <Icon className={`w-5 h-5 mt-0.5 ${selectedChannel === channel ? config.color : 'text-text-secondary'}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{config.label}</h4>
                      {!isAvailable && (
                        <span className="px-2 py-0.5 text-xs bg-orange-100 text-orange-800 rounded">
                          Upgrade Required
                        </span>
                      )}
                      {channel === 'community' && (
                        <ExternalLink className="w-4 h-4 text-text-secondary" />
                      )}
                    </div>
                    <p className="text-sm text-text-secondary mt-1">
                      {config.description}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Support Form */}
      {selectedChannel && selectedChannel !== 'community' && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Subject <span className="text-red-500">*</span>
            </label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief description of your issue"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Priority <span className="text-red-500">*</span>
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="border border-input rounded-md h-10 px-3 text-sm bg-background"
            >
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Message <span className="text-red-500">*</span>
            </label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your issue in detail. Include steps to reproduce if it's a bug."
              rows={6}
              required
            />
          </div>

          {submitStatus === 'error' && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">Failed to submit request. Please try again.</span>
            </div>
          )}

          <Button
            type="submit"
            disabled={isSubmitting || !selectedChannel || !subject || !message}
            className="w-full"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Submit Request
              </>
            )}
          </Button>
        </form>
      )}

      {/* Community Forum Info */}
      {selectedChannel === 'community' && (
        <Card className="bg-blue-50 border-blue-200">
          <div className="flex items-start gap-3">
            <Users className="w-5 h-5 text-blue-600 mt-0.5" />
            <div>
              <h4 className="font-medium text-blue-900 mb-1">Community Forum</h4>
              <p className="text-sm text-blue-800 mb-3">
                Join our community forum to connect with other CheersAI users, share tips, 
                and get help from the community. Many common questions are already answered there!
              </p>
              <Button
                onClick={() => {
                  window.open('https://community.cheersai.co.uk', '_blank');
                  setSubmitStatus('success');
                }}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Visit Community Forum
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Upgrade Prompt for Free/Starter users */}
      {(subscriptionTier === 'free' || subscriptionTier === 'starter') && (
        <Card className="bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
          <h4 className="font-medium mb-2">Need faster support?</h4>
          <p className="text-sm text-text-secondary mb-3">
            Upgrade to Professional or Enterprise for priority email support, WhatsApp assistance, 
            and faster response times.
          </p>
          <Button
            onClick={() => window.location.href = '/settings#billing'}
            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
          >
            Upgrade Plan
          </Button>
        </Card>
      )}
    </div>
  );
}
