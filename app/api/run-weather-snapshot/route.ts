import { NextRequest, NextResponse } from 'next/server';
import { runWeatherSnapshotJob, OCT_NOV_RANGE } from '@/lib/weather/weatherSnapshotJob';

// This job makes ~120 sequential Open-Meteo calls (3 destinations x 20
// years x 2 APIs) with a 500ms delay before each one, plus per-year
// Supabase upserts — comfortably over Vercel's default serverless
// function timeout (10s Hobby / 15s Pro). Without this, the request
// would very likely be killed mid-run, leaving a snapshot_runs row with
// completed_at still NULL and only partial data written. 300s is the
// max allowed on Pro; raise further only if the account is on a plan
// that supports it.
export const maxDuration = 300;

async function runJob(): Promise<NextResponse> {
  try {
    const result = await runWeatherSnapshotJob({
      dateRange: OCT_NOV_RANGE,
    });

    return NextResponse.json({
      runId:   result.runId,
      total:   result.total,
      success: result.success,
      failed:  result.failed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[run-weather-snapshot] job failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey || apiKey !== process.env.SNAPSHOT_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return runJob();
}

// GET variant, auth'd via a ?key= query param instead of the x-api-key
// header. Exists so the job can be triggered by pasting a URL into a
// browser address bar: Postman's cloud proxy caps requests at 30s (well
// under this route's 300s maxDuration, so it can't wait for a real run to
// finish), and a local HTML file's fetch() gets blocked by CORS since it
// isn't served from this app's origin. A browser GET has neither problem.
export async function GET(request: NextRequest) {
  const apiKey = request.nextUrl.searchParams.get('key');
  if (!apiKey || apiKey !== process.env.SNAPSHOT_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return runJob();
}
