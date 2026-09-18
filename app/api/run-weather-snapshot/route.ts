import { NextRequest, NextResponse } from 'next/server';
import { runWeatherSnapshotJob, OCT_NOV_RANGE } from '@/lib/weather/weatherSnapshotJob';

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey || apiKey !== process.env.SNAPSHOT_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
