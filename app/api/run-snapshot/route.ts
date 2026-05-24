import { NextRequest, NextResponse } from 'next/server';
import { runSnapshotJob } from '@/lib/flights/snapshotJob';

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey || apiKey !== process.env.SNAPSHOT_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runSnapshotJob({
      targetWindows: [{
        label:     '2026-10-halfterm',
        dateStart: '2026-10-22',
        dateEnd:   '2026-11-02',
      }],
    });

    return NextResponse.json({
      runId:   result.runId,
      total:   result.total,
      success: result.success,
      failed:  result.failed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[run-snapshot] job failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
