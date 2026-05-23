"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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

/* Shared style objects for design tokens */
const fieldsetStyle: React.CSSProperties = {
  backgroundColor: "var(--c-card)",
  border: "1px solid var(--c-line)",
  borderRadius: "var(--r-2xl)",
  boxShadow: "var(--sh-sm)",
};

const inputStyle: React.CSSProperties = {
  backgroundColor: "var(--c-paper)",
  border: "1px solid var(--c-line)",
  borderRadius: "var(--r-xl)",
  color: "var(--c-ink-2)",
};

function getConnectionFormDefaultValues(data: ManagementConnectionSummary): ManagementConnectionFormValues {
  return {
    baseUrl: data.baseUrl,
    apiKey: "",
    enabled: data.enabled,
  };
}

export function ManagementConnectionForm({ data }: ManagementConnectionFormProps) {
  const router = useRouter();
  const [savePending, startSaveTransition] = useTransition();
  const [testPending, startTestTransition] = useTransition();
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const defaultValues = useMemo(() => getConnectionFormDefaultValues(data), [data]);

  const form = useForm<ManagementConnectionFormValues>({
    resolver: zodResolver(managementConnectionFormSchema) as Resolver<ManagementConnectionFormValues>,
    defaultValues,
  });
  const { reset } = form;

  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  const onSubmit = form.handleSubmit((values) => {
    setSaveMessage(null);

    startSaveTransition(async () => {
      try {
        const summary = await updateManagementConnectionSettings(values);
        reset(getConnectionFormDefaultValues(summary));
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

  // eslint-disable-next-line react-hooks/incompatible-library -- pre-existing: react-hook-form watch() is not memoizable, accepted trade-off
  const canTest = data.hasApiKey || Boolean(form.watch("apiKey")?.trim());

  return (
    <form className="space-y-6" onSubmit={onSubmit} id="management-connection">
      <fieldset className="p-6" style={fieldsetStyle} id="management-app-connection">
        <legend className="text-lg font-semibold" style={{ color: "var(--c-ink)" }}>Anchor management app</legend>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>Base URL</label>
            <input
              type="url"
              placeholder="https://management.orangejelly.co.uk"
              className="mt-2 w-full p-3 text-sm focus:outline-none"
              style={inputStyle}
              {...form.register("baseUrl")}
            />
            {form.formState.errors.baseUrl ? (
              <p className="mt-1 text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.baseUrl.message}</p>
            ) : null}
          </div>

          <div>
            <label className="text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>API key</label>
            <input
              type="password"
              placeholder={data.hasApiKey ? "Stored key present (leave blank to keep)" : "anch_..."}
              className="mt-2 w-full p-3 text-sm focus:outline-none"
              style={inputStyle}
              {...form.register("apiKey")}
            />
            <p className="mt-1 text-xs" style={{ color: "var(--c-ink-3)" }}>Leave blank to keep the current stored key.</p>
            {form.formState.errors.apiKey ? (
              <p className="mt-1 text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.apiKey.message}</p>
            ) : null}
          </div>
        </div>

        <label className="mt-4 inline-flex items-center gap-2 text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>
          <input type="checkbox" className="h-4 w-4" {...form.register("enabled")} />
          Enable imports from management app
        </label>

        <div
          className="mt-4 px-4 py-3 text-xs"
          style={{
            backgroundColor: "var(--c-paper)",
            border: "1px solid var(--c-line)",
            borderRadius: "var(--r-xl)",
            color: "var(--c-ink-3)",
          }}
        >
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
        <p className="text-sm" style={{ color: "var(--c-ink-3)" }} role="status">
          {saveMessage}
        </p>
      ) : null}

      {testMessage ? (
        <p className="text-sm" style={{ color: "var(--c-ink-3)" }} role="status">
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
