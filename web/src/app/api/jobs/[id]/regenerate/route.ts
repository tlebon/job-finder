import { NextResponse } from 'next/server';
import { getJobById, updateJobCoverLetter } from '@/lib/db';
import { generateCoverLetter } from '@/lib/coverLetter';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = getJobById(id);

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Generate new cover letter
    const result = await generateCoverLetter(job);

    // Optionally auto-save (can be controlled by query param)
    const url = new URL(request.url);
    const autoSave = url.searchParams.get('autoSave') === 'true';

    if (autoSave) {
      updateJobCoverLetter(id, result.final);
    }

    return NextResponse.json({
      draft: result.draft,
      feedback: result.feedback,
      final: result.final,
      saved: autoSave,
    });
  } catch (error) {
    console.error('Error regenerating cover letter:', error);
    return NextResponse.json({ error: 'Failed to regenerate cover letter' }, { status: 500 });
  }
}
