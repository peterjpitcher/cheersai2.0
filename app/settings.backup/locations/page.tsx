"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ChevronLeft, MapPin, Plus, Edit2, Trash2, 
  Loader2, CheckCircle, Store, Globe, Phone
} from "lucide-react";
import Link from "next/link";

interface Location {
  id: string;
  tenant_id: string;
  name: string;
  address: string;
  city: string;
  postcode: string;
  phone?: string;
  email?: string;
  google_place_id?: string;
  is_primary: boolean;
  social_accounts?: {
    facebook?: string;
    instagram?: string;
    twitter?: string;
    google?: string;
  };
  created_at: string;
}

export default function LocationsPage() {
  const router = useRouter();
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    address: "",
    city: "",
    postcode: "",
    phone: "",
    email: "",
    is_primary: false
  });

  useEffect(() => {
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
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

    const { data } = await supabase
      .from("business_locations")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });

    if (data) {
      setLocations(data);
    }
    setLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) return;

    // If setting as primary, unset other primary locations
    if (formData.is_primary && !editingLocation) {
      await supabase
        .from("business_locations")
        .update({ is_primary: false })
        .eq("tenant_id", userData.tenant_id);
    }

    const locationData = {
      ...formData,
      tenant_id: userData.tenant_id,
      updated_at: new Date().toISOString()
    };

    if (editingLocation) {
      // Update existing location
      const { error } = await supabase
        .from("business_locations")
        .update(locationData)
        .eq("id", editingLocation.id);

      if (!error) {
        setEditingLocation(null);
        setFormData({
          name: "",
          address: "",
          city: "",
          postcode: "",
          phone: "",
          email: "",
          is_primary: false
        });
        fetchLocations();
      }
    } else {
      // Create new location
      const { error } = await supabase
        .from("business_locations")
        .insert({
          ...locationData,
          created_at: new Date().toISOString()
        });

      if (!error) {
        setShowAddForm(false);
        setFormData({
          name: "",
          address: "",
          city: "",
          postcode: "",
          phone: "",
          email: "",
          is_primary: false
        });
        fetchLocations();
      }
    }
  };

  const handleEdit = (location: Location) => {
    setEditingLocation(location);
    setFormData({
      name: location.name,
      address: location.address,
      city: location.city,
      postcode: location.postcode,
      phone: location.phone || "",
      email: location.email || "",
      is_primary: location.is_primary
    });
    setShowAddForm(true);
  };

  const handleDelete = async (locationId: string) => {
    if (!confirm("Are you sure you want to delete this location?")) return;

    const supabase = createClient();
    const { error } = await supabase
      .from("business_locations")
      .delete()
      .eq("id", locationId);

    if (!error) {
      fetchLocations();
    }
  };

  const handleSetPrimary = async (locationId: string) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) return;

    // Unset all primary flags
    await supabase
      .from("business_locations")
      .update({ is_primary: false })
      .eq("tenant_id", userData.tenant_id);

    // Set new primary
    await supabase
      .from("business_locations")
      .update({ is_primary: true })
      .eq("id", locationId);

    fetchLocations();
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
              <Link href="/settings" className="text-text-secondary hover:text-primary">
                <ChevronLeft className="w-6 h-6" />
              </Link>
              <div>
                <h1 className="text-2xl font-heading font-bold">Business Locations</h1>
                <p className="text-sm text-text-secondary">
                  Manage your business locations
                </p>
              </div>
            </div>
            {!showAddForm && (
              <button
                onClick={() => setShowAddForm(true)}
                className="btn-primary"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Location
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Add/Edit Form */}
        {showAddForm && (
          <div className="card mb-6">
            <h3 className="font-semibold mb-4">
              {editingLocation ? "Edit Location" : "Add New Location"}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Location Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="input-field"
                    placeholder="e.g., Main Street Pub"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="input-field"
                    placeholder="01234 567890"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Street Address *
                </label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="input-field"
                  placeholder="123 High Street"
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-2">
                    City *
                  </label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="input-field"
                    placeholder="London"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Postcode *
                  </label>
                  <input
                    type="text"
                    value={formData.postcode}
                    onChange={(e) => setFormData({ ...formData, postcode: e.target.value })}
                    className="input-field"
                    placeholder="SW1A 1AA"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="input-field"
                  placeholder="location@example.com"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_primary"
                  checked={formData.is_primary}
                  onChange={(e) => setFormData({ ...formData, is_primary: e.target.checked })}
                  className="w-4 h-4 text-primary"
                />
                <label htmlFor="is_primary" className="text-sm">
                  Set as primary location
                </label>
              </div>

              <div className="flex gap-3">
                <button type="submit" className="btn-primary">
                  {editingLocation ? "Update Location" : "Add Location"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(false);
                    setEditingLocation(null);
                    setFormData({
                      name: "",
                      address: "",
                      city: "",
                      postcode: "",
                      phone: "",
                      email: "",
                      is_primary: false
                    });
                  }}
                  className="btn-ghost"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Locations List */}
        {locations.length === 0 ? (
          <div className="card text-center py-12">
            <Store className="w-12 h-12 text-text-secondary mx-auto mb-4" />
            <h3 className="font-semibold text-lg mb-2">No Locations Yet</h3>
            <p className="text-text-secondary mb-4">
              Add your business locations to manage them separately
            </p>
            {!showAddForm && (
              <button
                onClick={() => setShowAddForm(true)}
                className="btn-primary mx-auto"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Location
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {locations.map((location) => (
              <div key={location.id} className="card">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <MapPin className="w-5 h-5 text-primary" />
                      <h3 className="font-semibold text-lg">{location.name}</h3>
                      {location.is_primary && (
                        <span className="badge-primary text-xs">Primary</span>
                      )}
                    </div>
                    
                    <div className="space-y-1 text-sm text-text-secondary">
                      <p>{location.address}</p>
                      <p>{location.city}, {location.postcode}</p>
                      
                      <div className="flex flex-wrap gap-4 mt-3">
                        {location.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-4 h-4" />
                            {location.phone}
                          </span>
                        )}
                        {location.email && (
                          <span className="flex items-center gap-1">
                            <Globe className="w-4 h-4" />
                            {location.email}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {!location.is_primary && (
                      <button
                        onClick={() => handleSetPrimary(location.id)}
                        className="text-text-secondary hover:text-primary p-2"
                        title="Set as primary"
                      >
                        <CheckCircle className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleEdit(location)}
                      className="text-text-secondary hover:text-primary p-2"
                      title="Edit"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(location.id)}
                      className="text-text-secondary hover:text-error p-2"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Info */}
        <div className="mt-8 p-4 bg-primary/5 rounded-medium">
          <h4 className="font-semibold text-sm mb-2">Multi-Location Benefits</h4>
          <ul className="text-sm text-text-secondary space-y-1">
            <li>• Generate location-specific content</li>
            <li>• Track performance by location</li>
            <li>• Manage social accounts per location</li>
            <li>• Create targeted local campaigns</li>
          </ul>
        </div>
      </main>
    </div>
  );
}