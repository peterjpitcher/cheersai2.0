"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 
  Beer, ChevronRight, 
  ChevronLeft, Loader2, Check, Coffee, Utensils, Hotel,
  Globe, Sparkles, Palette
} from "lucide-react";
import Logo from "@/components/ui/logo";

const BUSINESS_TYPES = [
  { id: "pub", label: "Traditional Pub", icon: Beer },
  { id: "bar", label: "Modern Bar", icon: Coffee },
  { id: "restaurant", label: "Restaurant", icon: Utensils },
  { id: "hotel", label: "Hotel Bar", icon: Hotel },
];

const TONE_ATTRIBUTES = [
  "Friendly", "Professional", "Witty", "Traditional", 
  "Modern", "Casual", "Upbeat", "Sophisticated"
];

const BRAND_COLORS = [
  { name: "Classic Orange", color: "#EA580C" }, // Default CheersAI
  { name: "Deep Blue", color: "#1E40AF" },
  { name: "Forest Green", color: "#166534" },
  { name: "Royal Purple", color: "#7C3AED" },
  { name: "Crimson Red", color: "#DC2626" },
  { name: "Warm Gold", color: "#CA8A04" },
  { name: "Teal", color: "#0891B2" },
  { name: "Rose", color: "#E11D48" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [analyzingWebsite, setAnalyzingWebsite] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [formData, setFormData] = useState({
    businessType: "",
    toneAttributes: [] as string[],
    targetAudience: "",
    brandColor: "#EA580C", // Default color
  });

  useEffect(() => {
    // Check if user is authenticated
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push("/auth/login");
    }
  };

  const handleBusinessTypeSelect = (type: string) => {
    setFormData({ ...formData, businessType: type });
  };

  const handleToneToggle = (tone: string) => {
    const tones = formData.toneAttributes;
    if (tones.includes(tone)) {
      setFormData({
        ...formData,
        toneAttributes: tones.filter(t => t !== tone)
      });
    } else if (tones.length < 3) {
      setFormData({
        ...formData,
        toneAttributes: [...tones, tone]
      });
    }
  };

  const analyzeWebsite = async () => {
    if (!websiteUrl) {
      alert("Please enter a website URL");
      return;
    }

    setAnalyzingWebsite(true);
    
    try {
      const response = await fetch("/api/analyze-website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: websiteUrl }),
      });

      const data = await response.json();
      
      if (data.error) {
        alert(data.error);
      } else {
        // Update the target audience field
        setFormData({ ...formData, targetAudience: data.targetAudience });
        
        // Show warning if there was an issue but we provided a fallback
        if (data.warning) {
          alert(`Note: ${data.warning}\n\nWe've provided a suggested description that you can customize.`);
        } else if (data.fallback) {
          // Successfully analyzed, no need for additional message
        }
      }
    } catch (error) {
      console.error("Website analysis error:", error);
      alert("Failed to analyze website. Please try again or enter manually.");
    } finally {
      setAnalyzingWebsite(false);
    }
  };

  const handleComplete = async () => {
    setLoading(true);
    const supabase = createClient();
    
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user found");

      // Get user metadata
      const pubName = user.user_metadata?.pub_name || "My Pub";
      const fullName = user.user_metadata?.full_name || "";
      
      // Create slug from pub name
      const slug = pubName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

      // Create tenant
      const { data: tenant, error: tenantError } = await supabase
        .from("tenants")
        .insert({
          name: pubName,
          slug: slug + '-' + Date.now(), // Ensure uniqueness
        })
        .select()
        .single();

      if (tenantError) throw tenantError;

      // Create or update user record (upsert to handle existing records)
      const { error: userError } = await supabase
        .from("users")
        .upsert({
          id: user.id,
          tenant_id: tenant.id,
          full_name: fullName || user.email?.split('@')[0] || 'User',
          email: user.email,
          role: 'owner',
        }, {
          onConflict: 'id'
        });

      if (userError) {
        console.error("User creation error:", userError.message);
        throw userError;
      }

      // Create brand profile
      const { error: brandError } = await supabase
        .from("brand_profiles")
        .insert({
          tenant_id: tenant.id,
          business_type: formData.businessType,
          tone_attributes: formData.toneAttributes,
          target_audience: formData.targetAudience,
          primary_color: formData.brandColor,
        });

      if (brandError) throw brandError;

      // IMPORTANT: Create user_tenants relationship for multi-tenant support
      // This is required for RLS policies to work correctly
      const { error: userTenantError } = await supabase
        .from("user_tenants")
        .insert({
          user_id: user.id,
          tenant_id: tenant.id,
          role: 'owner',
        });

      if (userTenantError) {
        console.error("User-tenant relationship creation error:", userTenantError);
        // Don't throw here as the main records are created
        // The user_tenants might already exist or not be required
      }

      // Redirect to dashboard
      router.push("/dashboard");
    } catch (error: any) {
      console.error("Onboarding error details:", {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint
      });
      
      let errorMessage = "Something went wrong during setup. ";
      
      if (error?.code === '23505') {
        errorMessage = "An account already exists. Please contact support.";
      } else if (error?.code === '42703') {
        errorMessage = "Database configuration error. Please contact support.";
      } else if (error?.message?.includes('email')) {
        errorMessage = "Email configuration error. Please try again.";
      } else if (error?.message) {
        errorMessage += error.message;
      } else {
        errorMessage += "Please try again or contact support.";
      }
      
      alert(errorMessage);
      setLoading(false);
    }
  };

  const canProceed = () => {
    switch (step) {
      case 1:
        return formData.businessType !== "";
      case 2:
        return formData.toneAttributes.length > 0;
      case 3:
        return formData.targetAudience !== "";
      case 4:
        return formData.brandColor !== "";
      default:
        return false;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Logo variant="full" />
        </div>
        
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between mb-2">
            {[1, 2, 3, 4].map((s) => (
              <div
                key={s}
                className={`flex items-center ${s < 4 ? 'flex-1' : ''}`}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                    step >= s
                      ? 'bg-primary text-white'
                      : 'bg-gray-200 text-gray-400'
                  }`}
                >
                  {step > s ? <Check className="w-5 h-5" /> : s}
                </div>
                {s < 4 && (
                  <div
                    className={`flex-1 h-1 mx-2 ${
                      step > s ? 'bg-primary' : 'bg-gray-200'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="card">
          {step === 1 && (
            <>
              <h2 className="text-2xl font-heading font-bold mb-2">What type of business do you run?</h2>
              <p className="text-text-secondary mb-6">This helps us tailor content to your industry</p>
              
              <div className="grid grid-cols-2 gap-4">
                {BUSINESS_TYPES.map((type) => {
                  const Icon = type.icon;
                  return (
                    <button
                      key={type.id}
                      onClick={() => handleBusinessTypeSelect(type.id)}
                      className={`p-6 rounded-medium border-2 transition-all ${
                        formData.businessType === type.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <Icon className="w-8 h-8 mx-auto mb-3 text-primary" />
                      <p className="font-medium">{type.label}</p>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-2xl font-heading font-bold mb-2">How would you describe your brand's voice?</h2>
              <p className="text-text-secondary mb-6">Choose up to 3 attributes that best represent your pub</p>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {TONE_ATTRIBUTES.map((tone) => (
                  <button
                    key={tone}
                    onClick={() => handleToneToggle(tone)}
                    disabled={!formData.toneAttributes.includes(tone) && formData.toneAttributes.length >= 3}
                    className={`px-4 py-3 rounded-soft border-2 transition-all ${
                      formData.toneAttributes.includes(tone)
                        ? 'border-primary bg-primary text-white'
                        : 'border-border hover:border-primary/50 disabled:opacity-50 disabled:cursor-not-allowed'
                    }`}
                  >
                    {tone}
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-2xl font-heading font-bold mb-2">Who is your target audience?</h2>
              <p className="text-text-secondary mb-6">Tell us about your typical customers</p>
              
              {/* Website Analysis Option */}
              <div className="bg-primary/5 border border-primary/20 rounded-medium p-4 mb-4">
                <div className="flex items-start gap-3">
                  <Globe className="w-5 h-5 text-primary mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium mb-2">Have a website? Let AI analyze it</p>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={websiteUrl}
                        onChange={(e) => setWebsiteUrl(e.target.value)}
                        placeholder="https://yourpub.com"
                        className="flex-1 input-field text-sm"
                        disabled={analyzingWebsite}
                      />
                      <button
                        onClick={analyzeWebsite}
                        disabled={analyzingWebsite || !websiteUrl}
                        className="btn-secondary text-sm flex items-center"
                      >
                        {analyzingWebsite ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4 mr-1" />
                            Analyze
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              
              <textarea
                value={formData.targetAudience}
                onChange={(e) => setFormData({ ...formData, targetAudience: e.target.value })}
                className="input-field min-h-[120px]"
                placeholder="E.g., Local families, young professionals, sports fans, tourists..."
              />
            </>
          )}

          {step === 4 && (
            <>
              <h2 className="text-2xl font-heading font-bold mb-2">Choose your brand color</h2>
              <p className="text-text-secondary mb-6">Select a color that represents your brand identity</p>
              
              <div className="grid grid-cols-4 gap-4 mb-6">
                {BRAND_COLORS.map((brandColor) => (
                  <button
                    key={brandColor.color}
                    onClick={() => setFormData({ ...formData, brandColor: brandColor.color })}
                    className={`relative p-4 rounded-medium border-2 transition-all ${
                      formData.brandColor === brandColor.color
                        ? 'border-primary ring-2 ring-primary/20'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <div 
                      className="w-full h-16 rounded-soft mb-2"
                      style={{ backgroundColor: brandColor.color }}
                    />
                    <p className="text-xs font-medium text-center">{brandColor.name}</p>
                    {formData.brandColor === brandColor.color && (
                      <div className="absolute top-2 right-2 bg-white rounded-full p-1">
                        <Check className="w-3 h-3 text-primary" />
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {/* Custom Color Option */}
              <div className="border border-border rounded-medium p-4">
                <div className="flex items-center gap-3">
                  <Palette className="w-5 h-5 text-primary" />
                  <div className="flex-1">
                    <p className="text-sm font-medium mb-1">Custom Color</p>
                    <p className="text-xs text-text-secondary">Enter your brand's hex color code</p>
                  </div>
                  <input
                    type="color"
                    value={formData.brandColor}
                    onChange={(e) => setFormData({ ...formData, brandColor: e.target.value })}
                    className="w-20 h-10 rounded cursor-pointer"
                  />
                </div>
              </div>

              {/* Live Preview */}
              <div className="mt-6 p-4 border border-border rounded-medium">
                <p className="text-sm text-text-secondary mb-2">Preview:</p>
                <div className="flex gap-2">
                  <button 
                    className="px-4 py-2 rounded text-white text-sm font-medium"
                    style={{ backgroundColor: formData.brandColor }}
                  >
                    Primary Button
                  </button>
                  <button 
                    className="px-4 py-2 rounded border-2 text-sm font-medium"
                    style={{ borderColor: formData.brandColor, color: formData.brandColor }}
                  >
                    Secondary Button
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Navigation Buttons */}
          <div className="flex justify-between mt-8">
            {step > 1 && (
              <button
                onClick={() => setStep(step - 1)}
                className="btn-ghost flex items-center"
              >
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back
              </button>
            )}
            
            <div className={step === 1 ? 'ml-auto' : ''}>
              {step < 4 ? (
                <button
                  onClick={() => setStep(step + 1)}
                  disabled={!canProceed()}
                  className="btn-primary flex items-center"
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-2" />
                </button>
              ) : (
                <button
                  onClick={handleComplete}
                  disabled={!canProceed() || loading}
                  className="btn-primary flex items-center"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      Complete Setup
                      <Check className="w-4 h-4 ml-2" />
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}