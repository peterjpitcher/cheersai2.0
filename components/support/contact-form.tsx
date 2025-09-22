"use client";

import { useState, useId } from "react";
import { MessageCircle, Mail, Phone, Users, Send, CheckCircle, AlertCircle, ExternalLink } from "lucide-react";
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
  const baseId = useId();
  const fieldId = (suffix: string) => `${baseId}-${suffix}`;

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
      <Card className="py-12 text-center">
        <CheckCircle className="mx-auto mb-4 size-12 text-green-600" />
        <h3 className="mb-2 text-xl font-semibold">Request Submitted!</h3>
        <p className="mb-6 text-text-secondary">
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
        <span className={`rounded-full px-3 py-1 text-sm font-medium capitalize ${getTierBadgeColor(subscriptionTier)}`}>
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
                  w-full rounded-lg border-2 p-4 text-left transition-all
                  ${selectedChannel === channel 
                    ? `${config.bgColor} border-current` 
                    : 'border-border bg-white hover:border-primary/40'
                  }
                  ${!isAvailable ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
                `}
              >
                <div className="flex items-start gap-3">
                  <Icon className={`mt-0.5 size-5 ${selectedChannel === channel ? config.color : 'text-text-secondary'}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{config.label}</h4>
                      {!isAvailable && (
                        <span className="rounded bg-orange-100 px-2 py-0.5 text-xs text-orange-800">
                          Upgrade Required
                        </span>
                      )}
                      {channel === 'community' && (
                        <ExternalLink className="size-4 text-text-secondary" />
                      )}
                    </div>
                    <p className="mt-1 text-sm text-text-secondary">
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
            <label className="mb-2 block text-sm font-medium" htmlFor={fieldId('subject')}>
              Subject <span className="text-red-500">*</span>
            </label>
            <Input
              id={fieldId('subject')}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief description of your issue"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor={fieldId('priority')}>
              Priority <span className="text-red-500">*</span>
            </label>
            <select
              id={fieldId('priority')}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor={fieldId('message')}>
              Message <span className="text-red-500">*</span>
            </label>
            <Textarea
              id={fieldId('message')}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your issue in detail. Include steps to reproduce if it's a bug."
              rows={6}
              required
            />
          </div>

          {submitStatus === 'error' && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
              <AlertCircle className="size-4" />
              <span className="text-sm">Failed to submit request. Please try again.</span>
            </div>
          )}

          <Button type="submit" loading={isSubmitting} disabled={!selectedChannel || !subject || !message} className="w-full">
            {!isSubmitting && <Send className="mr-2 size-4" />}
            Submit Request
          </Button>
        </form>
      )}

      {/* Community Forum Info */}
      {selectedChannel === 'community' && (
        <Card className="border-blue-200 bg-blue-50">
          <div className="flex items-start gap-3">
            <Users className="mt-0.5 size-5 text-blue-600" />
            <div>
              <h4 className="mb-1 font-medium text-blue-900">Community Forum</h4>
              <p className="mb-3 text-sm text-blue-800">
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
                <ExternalLink className="mr-2 size-4" />
                Visit Community Forum
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Upgrade Prompt for Free/Starter users */}
      {(subscriptionTier === 'free' || subscriptionTier === 'starter') && (
        <Card className="border-purple-200 bg-gradient-to-r from-purple-50 to-blue-50">
          <h4 className="mb-2 font-medium">Need faster support?</h4>
          <p className="mb-3 text-sm text-text-secondary">
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
