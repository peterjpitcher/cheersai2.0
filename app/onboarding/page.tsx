"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { completeOnboarding } from "@/app/actions/onboarding";
import { 
  Beer, ChevronRight, 
  ChevronLeft, ChevronDown, Loader2, Check, Coffee, Utensils, Hotel,
  Globe, Sparkles, Palette, Upload, Image
} from "lucide-react";
import Logo from "@/components/ui/logo";

const BUSINESS_TYPES = [
  { id: "pub", label: "Traditional Pub", icon: Beer },
  { id: "bar", label: "Modern Bar", icon: Coffee },
  { id: "restaurant", label: "Restaurant", icon: Utensils },
  { id: "hotel", label: "Hotel Bar", icon: Hotel },
];

// Removed TONE_ATTRIBUTES - now using free text for brand voice

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
  const [analysingWebsite, setAnalysingWebsite] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [formData, setFormData] = useState({
    businessType: "",
    brandVoice: "",
    targetAudience: "",
    brandColor: "#EA580C", // Default color
    logoFile: null as File | null,
    logoPreview: "",
    brandIdentity: "",
  });
  
  // State for collapsed example sections
  const [expandedExamples, setExpandedExamples] = useState({
    brandVoice: false,
    targetAudience: false,
    brandIdentity: false,
  });
  
  const toggleExample = (field: keyof typeof expandedExamples) => {
    setExpandedExamples(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

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

  // Removed handleToneToggle - now using free text for brand voice

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith("image/")) {
        alert("Please upload an image file");
        return;
      }
      
      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData({
          ...formData,
          logoFile: file,
          logoPreview: reader.result as string,
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const analyseWebsite = async () => {
    if (!websiteUrl) {
      // Focus on the URL input instead of showing alert
      const urlInput = document.querySelector('input[type="url"]') as HTMLInputElement;
      urlInput?.focus();
      return;
    }

    setAnalysingWebsite(true);
    
    try {
      const response = await fetch("/api/analyse-website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: websiteUrl }),
      });

      const data = await response.json();
      
      if (data.error) {
        alert(`${data.error}\n\nNo worries - you can fill in your brand information manually below.`);
      } else {
        // Update all brand fields from the analysis
        setFormData(prev => ({
          ...prev,
          targetAudience: data.targetAudience || prev.targetAudience,
          brandVoice: data.brandVoice || prev.brandVoice,
          brandIdentity: data.brandIdentity || prev.brandIdentity,
        }));
        
        // Show success message
        if (data.warning) {
          alert(`Website analysed! We've provided suggested brand information that you can customise below.`);
        } else {
          // Successfully analysed - show brief success message
          alert("Great! Your website has been analysed and your brand information has been populated. Feel free to customise any of the fields below.");
        }
      }
    } catch (error) {
      console.error("Website analysis error:", error);
      alert("Unable to analyse website right now. No problem - just fill in your brand information manually below!");
    } finally {
      setAnalysingWebsite(false);
    }
  };

  const handleComplete = async () => {
    setLoading(true);
    
    try {
      const result = await completeOnboarding({
        businessType: formData.businessType,
        brandVoice: formData.brandVoice,
        targetAudience: formData.targetAudience,
        brandIdentity: formData.brandIdentity,
        brandColor: formData.brandColor,
        logoFile: formData.logoPreview || null // Send base64 data if exists
      });
      
      if (result.success) {
        // Success! Navigate to dashboard
        router.push('/dashboard');
      } else {
        throw new Error('Onboarding failed');
      }
    } catch (error: any) {
      console.error("Onboarding error:", error);
      
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
        // Brand & Audience step - require audience, voice, and identity
        return formData.targetAudience !== "" && 
               formData.brandVoice !== "" && 
               formData.brandIdentity !== "";
      case 3:
        return formData.brandColor !== "";
      case 4:
        return true; // Logo is optional
      default:
        return false;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl">
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
              <h2 className="text-2xl font-heading font-bold mb-2">Define Your Brand & Audience</h2>
              <p className="text-text-secondary mb-6">Tell us about your brand identity and who you serve</p>
              
              {/* Website Analysis Option */}
              <div className="bg-primary/5 border border-primary/20 rounded-medium p-4 mb-6">
                <div className="flex items-start gap-3">
                  <Globe className="w-5 h-5 text-primary mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-sm font-medium">AI Website Analysis</p>
                      <span className="px-2 py-1 text-xs bg-primary/10 text-primary rounded-full font-medium">
                        Recommended
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary mb-3">
                      Let AI analyse your website to automatically extract your brand voice, target audience, and identity. 
                      This saves time and ensures consistency with your existing brand.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={websiteUrl}
                        onChange={(e) => setWebsiteUrl(e.target.value)}
                        placeholder="https://yourpub.com (optional)"
                        className="flex-1 input-field text-sm"
                        disabled={analysingWebsite}
                      />
                      <button
                        onClick={analyseWebsite}
                        disabled={analysingWebsite || !websiteUrl}
                        className="btn-secondary text-sm flex items-center"
                      >
                        {analysingWebsite ? (
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

              <div className="space-y-6">
                {/* Brand Voice Text Field */}
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Brand Voice & Tone
                  </label>
                  <textarea
                    value={formData.brandVoice}
                    onChange={(e) => setFormData({ ...formData, brandVoice: e.target.value })}
                    className="input-field min-h-[100px]"
                    placeholder="Describe how your brand communicates..."
                    maxLength={500}
                  />
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-xs text-text-secondary">
                      {formData.brandVoice.length}/500 characters
                    </p>
                    <button
                      type="button"
                      onClick={() => toggleExample('brandVoice')}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <ChevronDown className={`w-3 h-3 transition-transform ${expandedExamples.brandVoice ? 'rotate-180' : ''}`} />
                      See examples
                    </button>
                  </div>
                  {expandedExamples.brandVoice && (
                    <div className="mt-3 p-3 bg-background border border-border rounded-soft text-sm text-text-secondary space-y-2">
                      <p className="font-medium text-text">Example brand voices:</p>
                      <p>• <strong>Traditional Pub:</strong> "We speak in a warm, friendly tone with a touch of traditional British humour. Our voice is welcoming and inclusive, making everyone feel like a local regular."</p>
                      <p>• <strong>Gastropub:</strong> "Our voice blends sophistication with approachability. We're passionate about food and drink, sharing our expertise without being pretentious."</p>
                      <p>• <strong>Sports Bar:</strong> "We're energetic, enthusiastic, and always up for banter. Our tone is lively and social, creating excitement around match days and events."</p>
                    </div>
                  )}
                </div>

                {/* Target Audience */}
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Target Audience
                  </label>
                  <textarea
                    value={formData.targetAudience}
                    onChange={(e) => setFormData({ ...formData, targetAudience: e.target.value })}
                    className="input-field min-h-[100px]"
                    placeholder="Describe your typical customers..."
                  />
                  <div className="flex justify-end mt-1">
                    <button
                      type="button"
                      onClick={() => toggleExample('targetAudience')}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <ChevronDown className={`w-3 h-3 transition-transform ${expandedExamples.targetAudience ? 'rotate-180' : ''}`} />
                      See examples
                    </button>
                  </div>
                  {expandedExamples.targetAudience && (
                    <div className="mt-3 p-3 bg-background border border-border rounded-soft text-sm text-text-secondary space-y-2">
                      <p className="font-medium text-text">Example audiences:</p>
                      <p>• <strong>Village Pub:</strong> "Local families, elderly regulars, weekend walkers, and visitors exploring the countryside. They value tradition, community, and a warm welcome."</p>
                      <p>• <strong>City Centre Bar:</strong> "Young professionals aged 25-40, after-work crowds, weekend socializers, and pre-theatre diners. They appreciate quality cocktails and a vibrant atmosphere."</p>
                      <p>• <strong>Gastro Pub:</strong> "Food enthusiasts, couples on date nights, business lunchers, and special occasion diners. They seek quality ingredients and memorable dining experiences."</p>
                    </div>
                  )}
                </div>

                {/* Brand Identity */}
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Brand Identity & Story
                  </label>
                  <textarea
                    value={formData.brandIdentity}
                    onChange={(e) => setFormData({ ...formData, brandIdentity: e.target.value })}
                    className="input-field min-h-[120px]"
                    placeholder="Share your story, values, and what makes you unique..."
                    maxLength={1000}
                  />
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-xs text-text-secondary">
                      {formData.brandIdentity.length}/1000 characters
                    </p>
                    <button
                      type="button"
                      onClick={() => toggleExample('brandIdentity')}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <ChevronDown className={`w-3 h-3 transition-transform ${expandedExamples.brandIdentity ? 'rotate-180' : ''}`} />
                      See examples
                    </button>
                  </div>
                  {expandedExamples.brandIdentity && (
                    <div className="mt-3 p-3 bg-background border border-border rounded-soft text-sm text-text-secondary space-y-2">
                      <p className="font-medium text-text">Example brand stories:</p>
                      <p>• <strong>Family Heritage:</strong> "Established in 1952 by the Thompson family, we've been the heart of the village for three generations. We pride ourselves on maintaining traditions while embracing modern hospitality. Our commitment to local suppliers and seasonal menus reflects our deep community roots."</p>
                      <p>• <strong>Modern Revival:</strong> "After lovingly restoring this Victorian coaching inn, we've created a space that honours history while celebrating contemporary craft. We champion independent breweries, showcase local artists, and host community events that bring people together."</p>
                      <p>• <strong>Culinary Focus:</strong> "We're passionate about elevating pub dining without losing the warmth of traditional hospitality. Our chef-owner brings Michelin experience to hearty British classics, sourcing from farms within 20 miles. We believe great food should be enjoyed in a relaxed, unpretentious setting."</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-2xl font-heading font-bold mb-2">Choose your brand colour</h2>
              <p className="text-text-secondary mb-6">Select a colour that represents your brand identity</p>
              
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

              {/* Custom Colour Option */}
              <div className="border border-border rounded-medium p-4">
                <div className="flex items-center gap-3">
                  <Palette className="w-5 h-5 text-primary" />
                  <div className="flex-1">
                    <p className="text-sm font-medium mb-1">Custom Colour</p>
                    <p className="text-xs text-text-secondary">Enter your brand's hex colour code</p>
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

          {step === 4 && (
            <>
              <h2 className="text-2xl font-heading font-bold mb-2">Add your logo (optional)</h2>
              <p className="text-text-secondary mb-6">Upload your logo to watermark your images</p>
              
              <div className="space-y-6">
                {/* Logo Upload Area */}
                <div className="border-2 border-dashed border-border rounded-medium p-8 text-center">
                  {formData.logoPreview ? (
                    <div className="space-y-4">
                      <div className="w-32 h-32 mx-auto bg-gray-100 rounded-medium p-4">
                        <img 
                          src={formData.logoPreview} 
                          alt="Logo preview" 
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <p className="text-sm text-text-secondary">{formData.logoFile?.name}</p>
                      <button
                        onClick={() => setFormData({ ...formData, logoFile: null, logoPreview: "" })}
                        className="text-sm text-error hover:underline"
                      >
                        Remove logo
                      </button>
                    </div>
                  ) : (
                    <>
                      <Image className="w-12 h-12 text-text-secondary/50 mx-auto mb-3" />
                      <input
                        type="file"
                        id="logo-upload"
                        accept="image/*"
                        onChange={handleLogoUpload}
                        className="hidden"
                      />
                      <label
                        htmlFor="logo-upload"
                        className="btn-primary inline-flex items-center cursor-pointer"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        Choose Logo
                      </label>
                      <p className="text-sm text-text-secondary mt-3">
                        PNG or SVG with transparent background recommended
                      </p>
                    </>
                  )}
                </div>

                {/* Info Box */}
                <div className="bg-primary/5 border border-primary/20 rounded-medium p-4">
                  <p className="text-sm">
                    <strong>💡 Tip:</strong> You can upload multiple logo versions later in Settings. 
                    Your logo will be automatically added to images you upload as a watermark.
                  </p>
                </div>

                {/* Skip Option */}
                <div className="text-center">
                  <button
                    onClick={() => handleComplete()}
                    className="text-sm text-text-secondary hover:underline"
                  >
                    Skip for now
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
                  disabled={loading}
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