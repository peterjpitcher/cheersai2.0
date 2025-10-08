import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase credentials. Provide NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  const { data: assets, error } = await supabase
    .from('media_assets')
    .select('id, media_type, derived_variants, processed_status')
    .eq('media_type', 'image')
    .filter('derived_variants->>story', 'is', 'null');

  if (error) {
    throw error;
  }

  if (!assets?.length) {
    console.info('No media assets require story derivative regeneration.');
    return;
  }

  console.info(`Regenerating story derivatives for ${assets.length} asset(s).`);

  for (const asset of assets) {
    try {
      const response = await supabase.functions.invoke('media-derivatives', {
        body: { assetId: asset.id },
      });

      if (response.error) {
        console.error(`[derivatives] invoke failed for ${asset.id}`, response.error);
      } else {
        console.info(`[derivatives] invoked for ${asset.id}`);
      }
    } catch (invokeError) {
      console.error(`[derivatives] unexpected error for ${asset.id}`, invokeError);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
