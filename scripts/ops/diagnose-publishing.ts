import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
});

async function main() {
    console.log("Diagnosing publishing issues...");

    // 1. Check for stuck in_progress jobs
    console.log("\nChecking for stuck in_progress jobs...");
    const { data: stuckJobs, error: stuckError } = await supabase
        .from("publish_jobs")
        .select("*")
        .eq("status", "in_progress");

    if (stuckError) console.error("Error fetching stuck jobs:", stuckError);

    if (stuckJobs?.length) {
        console.log(`Found ${stuckJobs.length} stuck jobs:`);
        stuckJobs.forEach((job) => {
            console.log(`- Job ${job.id}: Last updated ${job.updated_at}, Content: ${job.content_item_id}`);
        });
    } else {
        console.log("No stuck jobs found.");
    }

    // 2. Check for due jobs in queue
    console.log("\nChecking for due queued jobs...");

    // Check jobs due more than 5 minutes ago
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { data: dueJobs, error: dueError } = await supabase
        .from("publish_jobs")
        .select("*")
        .eq("status", "queued")
        .lte("next_attempt_at", fiveMinsAgo);

    if (dueError) console.error("Error fetching due jobs:", dueError);

    if (dueJobs?.length) {
        console.log(`Found ${dueJobs.length} overdue queued jobs (due > 5 mins ago):`);
        dueJobs.forEach((job) => {
            console.log(`- Job ${job.id}: Due ${job.next_attempt_at}, Content: ${job.content_item_id}`);
        });
    } else {
        console.log("No overdue queued jobs found.");
    }

    // 3. Check for orphaned content (scheduled but no job)
    console.log("\nChecking for orphaned scheduled content...");
    const { data: scheduledContent, error: contentError } = await supabase
        .from("content_items")
        .select("id, status, scheduled_for, updated_at")
        .eq("status", "scheduled");

    if (contentError) console.error("Error fetching scheduled content:", contentError);

    if (scheduledContent?.length) {
        // Get all job content IDs
        const { data: allJobs } = await supabase
            .from("publish_jobs")
            .select("content_item_id");

        const jobContentIds = new Set(allJobs?.map((j) => j.content_item_id) ?? []);

        const orphaned = scheduledContent.filter((c) => !jobContentIds.has(c.id));
        if (orphaned.length) {
            console.log(`Found ${orphaned.length} orphaned scheduled items (no publish_job):`);
            orphaned.forEach((c) => {
                console.log(`- Content ${c.id}: Scheduled ${c.scheduled_for}`);
            });
        } else {
            console.log(`Found ${scheduledContent.length} scheduled items, all have jobs.`);
        }
    } else {
        console.log("No scheduled content found.");
    }
}

main().catch((err) => console.error(err));
