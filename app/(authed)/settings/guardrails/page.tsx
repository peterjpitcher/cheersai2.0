"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/datetime";

type Guardrail = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  context_type: "campaign" | "quick_post" | "brand_voice" | "general";
  platform: string | null;
  feedback_type: "avoid" | "include" | "tone" | "style" | "format" | "other";
  feedback_text: string;
  is_active: boolean;
  created_at: string;
};

const contextOptions = [
  { value: "", label: "All contexts" },
  { value: "campaign", label: "Campaign" },
  { value: "quick_post", label: "Quick post" },
  { value: "brand_voice", label: "Brand voice" },
  { value: "general", label: "General" },
] as const;

const typeOptions = [
  { value: "", label: "All types" },
  { value: "avoid", label: "Avoid" },
  { value: "include", label: "Include" },
  { value: "tone", label: "Tone" },
  { value: "style", label: "Style" },
  { value: "format", label: "Format" },
  { value: "other", label: "Other" },
] as const;

export default function GuardrailsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [guardrails, setGuardrails] = useState<Guardrail[]>([]);
  const [search, setSearch] = useState("");
  const [contextType, setContextType] = useState("");
  const [type, setType] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState({
    context_type: "general" as Guardrail["context_type"],
    platform: "",
    feedback_type: "avoid" as Guardrail["feedback_type"],
    feedback_text: "",
  });

  const fetchGuardrails = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (contextType) params.set("context_type", contextType);
      if (activeOnly) params.set("is_active", "true");
      const res = await fetch(`/api/guardrails?${params.toString()}`);
      const json = await res.json();
      setGuardrails(json.guardrails || []);
    } catch (e) {
      console.error("Failed to load guardrails", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGuardrails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextType, activeOnly]);

  const filtered = useMemo(() => {
    let rows = guardrails;
    if (type) rows = rows.filter(r => r.feedback_type === type);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        r.feedback_text.toLowerCase().includes(q) ||
        (r.platform || "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [guardrails, search, type]);

  const prettyPlatform = (p: string) =>
    p.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const toggleActive = async (id: string, current: boolean) => {
    try {
      setPageError(null);
      const res = await fetch("/api/guardrails", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, is_active: !current }),
      });
      if (!res.ok) throw new Error("Update failed");
      await fetchGuardrails();
    } catch (e) {
      console.error("Toggle failed", e);
      setPageError("Failed to update guardrail");
    }
  };

  const deleteItem = async (id: string) => {
    if (!confirm("Are you sure you want to delete this guardrail?")) return;
    try {
      setPageError(null);
      const res = await fetch(`/api/guardrails?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      await fetchGuardrails();
    } catch (e) {
      console.error("Delete failed", e);
      setPageError("Failed to delete guardrail");
    }
  };

  const addGuardrail = async () => {
    if (!newItem.feedback_text.trim()) {
      setRuleError("Please enter the guardrail text");
      return;
    }
    setAdding(true);
    try {
      setPageError(null);
      const res = await fetch("/api/guardrails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context_type: newItem.context_type,
          platform: newItem.platform || null,
          feedback_type: newItem.feedback_type,
          feedback_text: newItem.feedback_text.trim(),
        }),
      });
      if (!res.ok) throw new Error("Create failed");
      setNewItem({ context_type: "general", platform: "", feedback_type: "avoid", feedback_text: "" });
      setRuleError(null);
      await fetchGuardrails();
    } catch (e) {
      console.error("Create failed", e);
      setPageError("Failed to create guardrail");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">Guardrails</h1>
          <p className="text-text-secondary text-sm">Rules that the AI must follow when generating your content</p>
        </div>
      </div>
      {pageError && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-medium p-3">
          {pageError}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Add a guardrail</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-6">
            <div className="md:col-span-2">
              <label className="block text-sm mb-1">Context</label>
              <Select value={newItem.context_type} onChange={(e) => setNewItem({ ...newItem, context_type: e.target.value as any })}>
                {contextOptions.filter(o => o.value !== "").map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm mb-1">Platform (optional)</label>
              <Input placeholder="e.g. facebook, instagram_business" value={newItem.platform}
                onChange={(e) => setNewItem({ ...newItem, platform: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm mb-1">Type</label>
              <Select value={newItem.feedback_type} onChange={(e) => setNewItem({ ...newItem, feedback_type: e.target.value as any })}>
                {typeOptions.filter(o => o.value !== "").map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </div>
            <div className="md:col-span-5">
              <label className="block text-sm mb-1">Rule</label>
              <Input placeholder="Describe the rule, e.g. Avoid American spellings; use en-GB."
                value={newItem.feedback_text}
                onChange={(e) => { setNewItem({ ...newItem, feedback_text: e.target.value }); if (e.target.value.trim()) setRuleError(null); }} />
              {ruleError && (
                <div className="mt-2 bg-destructive/10 border border-destructive/30 text-destructive rounded-medium p-2 text-sm">
                  {ruleError}
                </div>
              )}
            </div>
            <div className="md:col-span-1 flex items-end">
              <Button onClick={addGuardrail} disabled={adding} className="w-full">
                {adding ? "Adding…" : "Add"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your guardrails</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4 mb-4">
            <div>
              <label className="block text-sm mb-1">Search</label>
              <Input placeholder="Search rules or platform…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm mb-1">Context</label>
              <Select value={contextType} onChange={(e) => setContextType(e.target.value)}>
                {contextOptions.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </Select>
            </div>
            <div>
              <label className="block text-sm mb-1">Type</label>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                {typeOptions.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </Select>
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-primary" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
                Active only
              </label>
            </div>
          </div>

          {loading ? (
            <div className="py-10 text-center text-text-secondary">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-text-secondary">No guardrails found</div>
          ) : (
            <div className="divide-y border rounded-large overflow-hidden">
              {filtered.map((g) => (
                <div key={g.id} className="flex items-start gap-4 p-4 bg-white">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary mb-1">
                      <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary">{g.feedback_type}</span>
                      <span className="px-2 py-0.5 rounded-full bg-gray-100">{g.context_type}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full ${g.platform ? "bg-secondary/10 text-secondary" : "bg-success/10 text-success"}`}
                      >
                        {g.platform ? `Channel: ${prettyPlatform(g.platform)}` : "All content"}
                      </span>
                      <span className="ml-auto text-xs">{formatDate(g.created_at)}</span>
                    </div>
                    <div className="text-sm">{g.feedback_text}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => toggleActive(g.id, g.is_active)}>
                      {g.is_active ? "Disable" : "Enable"}
                    </Button>
                    <Button variant="destructive" onClick={() => deleteItem(g.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
