import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { fetchAdCreativeMedia } from '@/lib/meta-api';

// GET /api/ad-performance/media?adId=META_AD_ID
// Fetches the full creative media (video source URL or full image) for a specific ad
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const adId = searchParams.get('adId');

  if (!adId) {
    return NextResponse.json({ error: 'adId required' }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  try {
    // Get all active accounts - try each until we find the right one
    const { data: accounts } = await supabase
      .from('meta_accounts')
      .select('id, access_token')
      .eq('is_active', true);

    if (!accounts?.length) {
      return NextResponse.json({ error: 'No active accounts' }, { status: 400 });
    }

    for (const account of accounts) {
      try {
        const media = await fetchAdCreativeMedia(adId, account.access_token);
        if (media.url) {
          return NextResponse.json(media);
        }
      } catch {
        continue;
      }
    }

    return NextResponse.json({ type: 'image', url: null });
  } catch (err) {
    console.error('Media fetch error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
