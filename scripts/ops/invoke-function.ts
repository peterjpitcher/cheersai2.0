#!/usr/bin/env tsx
export {};
const [, , functionName, payloadArg] = process.argv;

if (!functionName) {
  console.error("Usage: npm run ops:invoke -- <function-name> [jsonPayload]");
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
  process.exit(1);
}

const baseUrl = supabaseUrl.replace("https://", "");
const functionDomain = baseUrl.replace(".supabase.co", ".functions.supabase.co");
const functionUrl = `https://${functionDomain}/${functionName}`;

let body = "{}";
if (payloadArg) {
  try {
    JSON.parse(payloadArg);
    body = payloadArg;
  } catch (error) {
    console.error("Payload must be valid JSON.");
    console.error(error);
    process.exit(1);
  }
}

async function main() {
  const response = await fetch(functionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
      "X-Client-Info": "cheersai-ops-script",
    },
    body,
  });

  const contentType = response.headers.get("content-type") ?? "";
  let payload: unknown;
  if (contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch (error) {
      console.warn("Failed to parse JSON response", error);
      payload = await response.text();
    }
  } else {
    payload = await response.text();
  }

  if (!response.ok) {
    console.error(`Function ${functionName} responded with ${response.status}`);
    console.error(payload);
    process.exit(1);
  }

  console.log(`✅ ${functionName} invoked successfully (${response.status})`);
  if (payload) {
    console.dir(payload, { depth: 4 });
  }
}

await main().catch((error) => {
  console.error(`Unhandled error invoking ${functionName}`, error);
  process.exit(1);
});
