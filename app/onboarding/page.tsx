"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 
  Beer, ChevronRight, 
  ChevronLeft, Loader2, Check, Coffee, Utensils, Hotel,
  Globe, Sparkles, Palette, Upload, Image
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
    logoFile: null as File | null,
    logoPreview: "",
    brandIdentity: "", // New field for brand identity
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

  const analyzeWebsite = async () => {
    if (!websiteUrl) {
      // Focus on the URL input instead of showing alert
      const urlInput = document.querySelector('input[type="url"]') as HTMLInputElement;
      urlInput?.focus();
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
        alert(`${data.error}\n\nNo worries - you can describe your target audience manually below.`);
      } else {
        // Update the target audience field
        setFormData({ ...formData, targetAudience: data.targetAudience });
        
        // Show success message
        if (data.warning) {
          alert(`Website analyzed! We've provided a suggested description that you can customize below.`);
        } else {
          // Successfully analyzed - show brief success message
          alert("Great! Your website has been analyzed and the target audience field has been populated. Feel free to customize it below.");
        }
      }
    } catch (error) {
      console.error("Website analysis error:", error);
      alert("Unable to analyze website right now. No problem - just describe your target audience manually below!");
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
      const firstName = user.user_metadata?.first_name || fullName.split(' ')[0] || "";
      const lastName = user.user_metadata?.last_name || fullName.split(' ').slice(1).join(' ') || "";
      
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
          first_name: firstName || fullName.split(' ')[0] || user.email?.split('@')[0] || 'User',
          last_name: lastName || '',
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
          brand_identity: formData.brandIdentity, // Add brand identity
        });

      if (brandError) throw brandError;

      // Upload logo if provided
      if (formData.logoFile) {
        const fileExt = formData.logoFile.name.split('.').pop();
        const fileName = `${tenant.id}/logo-${Date.now()}.${fileExt}`;
        
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("media")
          .upload(fileName, formData.logoFile);

        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage
            .from("media")
            .getPublicUrl(fileName);

          // Save logo reference
          await supabase
            .from("tenant_logos")
            .insert({
              tenant_id: tenant.id,
              logo_type: 'default',
              file_url: publicUrl,
              file_name: formData.logoFile.name,
            });

          // Enable watermarking by default
          await supabase
            .from("watermark_settings")
            .insert({
              tenant_id: tenant.id,
              enabled: true,
              auto_apply: false,
            });
        }
      }

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
      case 5:
        return true; // Logo is optional
      case 6:
        return formData.brandIdentity.trim() !== ""; // Brand identity is required
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
            {[1, 2, 3, 4, 5, 6].map((s) => (
              <div
                key={s}
                className={`flex items-center ${s < 6 ? 'flex-1' : ''}`}
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
                {s < 6 && (
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
              
              {/* Website Analysis Option - Now Optional but Recommended */}
              <div className="bg-primary/5 border border-primary/20 rounded-medium p-4 mb-4">
                <div className="flex items-start gap-3">
                  <Globe className="w-5 h-5 text-primary mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-sm font-medium">Website Analysis</p>
                      <span className="px-2 py-1 text-xs bg-primary/10 text-primary rounded-full font-medium">
                        Recommended
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary mb-3">
                      Let AI analyze your website to automatically understand your target audience. 
                      This helps create more accurate and tailored content for your business.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={websiteUrl}
                        onChange={(e) => setWebsiteUrl(e.target.value)}
                        placeholder="https://yourpub.com (optional)"
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
                    <div className="mt-2 text-center">
                      <button
                        onClick={() => {
                          // Focus on the textarea to encourage manual entry
                          const textarea = document.querySelector('textarea[placeholder*="Local families"]') as HTMLTextAreaElement;
                          textarea?.focus();
                        }}
                        className="text-xs text-text-secondary hover:text-primary hover:underline"
                      >
                        Skip website analysis and describe manually
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">
                  Describe Your Target Audience
                </label>
                <textarea
                  value={formData.targetAudience}
                  onChange={(e) => setFormData({ ...formData, targetAudience: e.target.value })}
                  className="input-field min-h-[120px]"
                  placeholder="E.g., Local families, young professionals, sports fans, tourists..."
                />
                <p className="text-xs text-text-secondary mt-2">
                  You can describe your audience manually or use website analysis above to auto-populate this field.
                </p>
              </div>
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

          {step === 5 && (
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
                    onClick={() => setStep(step + 1)}
                    className="text-sm text-text-secondary hover:underline"
                  >
                    Skip for now
                  </button>
                </div>
              </div>
            </>
          )}

          {step === 6 && (
            <>
              <h2 className="text-2xl font-heading font-bold mb-2">Define Your Brand Identity</h2>
              <p className="text-text-secondary mb-6">
                Tell us who you are as a business - your story, values, and what makes you unique
              </p>
              
              <div className="space-y-6">
                {/* Brand Identity Text Area */}
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Your Brand Identity
                  </label>
                  <textarea
                    value={formData.brandIdentity}
                    onChange={(e) => setFormData({ ...formData, brandIdentity: e.target.value })}
                    className="input-field min-h-[200px]"
                    placeholder="Example: We're a traditional Irish pub established in 1952, family-owned for three generations. We pride ourselves on being the heart of the community, where locals gather for honest conversations over perfectly poured pints. We're not trendy or modern - we're authentic, warm, and reliable. Our identity is rooted in Irish hospitality, local sports support, and being a safe haven from the digital world..."
                    maxLength={1000}
                  />
                  <p className="text-xs text-text-secondary mt-2">
                    {formData.brandIdentity.length}/1000 characters
                  </p>
                </div>

                {/* Helper Questions */}
                <div className="bg-primary/5 border border-primary/20 rounded-medium p-4">
                  <p className="text-sm font-medium mb-3">Consider including:</p>
                  <ul className="space-y-2 text-sm text-text-secondary">
                    <li className="flex items-start gap-2">
                      <span className="text-primary mt-0.5">•</span>
                      <span>Your history and founding story</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-primary mt-0.5">•</span>
                      <span>What makes you different from competitors</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-primary mt-0.5">•</span>
                      <span>Your core values and beliefs</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-primary mt-0.5">•</span>
                      <span>The experience customers can expect</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-primary mt-0.5">•</span>
                      <span>Your role in the community</span>
                    </li>
                  </ul>
                </div>

                {/* Example Button */}
                <div className="text-center">
                  <button
                    onClick={() => {
                      if (!formData.brandIdentity) {
                        setFormData({
                          ...formData,
                          brandIdentity: "We're a family-run pub that's been serving our community since 1985. Known for our warm welcome, live traditional music sessions every Friday, and the best Sunday roast in town. We support local sports teams, host community events, and believe a good pub is about more than just drinks - it's about bringing people together."
                        });
                      }
                    }}
                    className="text-sm text-primary hover:underline"
                  >
                    Use example identity
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
              {step < 6 ? (
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