"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import type { ManagementConnectionSummary } from "@/lib/management-app/data";
import {
  managementConnectionFormSchema,
  type ManagementConnectionFormValues,
} from "@/features/settings/schema";
import {
  testManagementConnectionSettings,
  updateManagementConnectionSettings,
} from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";

interface ManagementConnectionFormProps {
  data: ManagementConnectionSummary;
}

export function ManagementConnectionForm({ data }: ManagementConnectionFormProps) {
  const router = useRouter();
  const [savePending, startSaveTransition] = useTransition();
  const [testPending, startTestTransition] = useTransition();
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const form = useForm<ManagementConnectionFormValues>({
    resolver: zodResolver(managementConnectionFormSchema) as Resolver<ManagementConnectionFormValues>,
    defaultValues: {
      baseUrl: data.baseUrl,
      apiKey: "",
      enabled: data.enabled,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    setSaveMessage(null);

    startSaveTransition(async () => {
      try {
        await updateManagementConnectionSettings(values);
        setSaveMessage("Management connection saved.");
        router.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to save management connection.";
        setSaveMessage(message);
      }
    });
  });

  const handleTestConnection = () => {
    setTestMessage(null);

    startTestTransition(async () => {
      const result = await testManagementConnectionSettings();
      setTestMessage(result.message);
      router.refresh();
    });
  };

  const canTest = data.hasApiKey || Boolean(form.watch("apiKey")?.trim());

  return (
    <form className="space-y-6" onSubmit={onSubmit} id="management-connection">
      <fieldset className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" id="management-app-connection">
        <legend className="text-lg font-semibold text-slate-900">Anchor management app</legend>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-slate-700">Base URL</label>
            <input
              type="url"
              placeholder="https://management.orangejelly.co.uk"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("baseUrl")}
            />
            {form.formState.errors.baseUrl ? (
              <p className="mt-1 text-xs text-rose-500">{form.formState.errors.baseUrl.message}</p>
            ) : null}
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700">API key</label>
            <input
              type="password"
              placeholder={data.hasApiKey ? "Stored key present (leave blank to keep)" : "anch_..."}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("apiKey")}
            />
            <p className="mt-1 text-xs text-slate-500">Leave blank to keep the current stored key.</p>
            {form.formState.errors.apiKey ? (
              <p className="mt-1 text-xs text-rose-500">{form.formState.errors.apiKey.message}</p>
            ) : null}
          </div>
        </div>

        <label className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" className="h-4 w-4" {...form.register("enabled")} />
          Enable imports from management app
        </label>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <p>
            Status: {data.configured ? "Configured" : "Not configured"} · {data.enabled ? "Enabled" : "Disabled"}
          </p>
          {data.lastTestedAt ? (
            <p>
              Last test: {new Date(data.lastTestedAt).toLocaleString()} ·
              {" "}
              {data.lastTestStatus === "ok" ? "Passed" : "Failed"}
            </p>
          ) : (
            <p>Last test: Not run</p>
          )}
          {data.lastTestMessage ? <p>Details: {data.lastTestMessage}</p> : null}
        </div>
      </fieldset>

      {saveMessage ? (
        <p className="text-sm text-slate-600" role="status">
          {saveMessage}
        </p>
      ) : null}

      {testMessage ? (
        <p className="text-sm text-slate-600" role="status">
          {testMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="outline" onClick={handleTestConnection} disabled={testPending || !canTest}>
          {testPending ? "Testing…" : "Test connection"}
        </Button>
        <Button type="submit" disabled={savePending}>
          {savePending ? "Saving…" : "Save connection"}
        </Button>
      </div>
    </form>
  );
}
