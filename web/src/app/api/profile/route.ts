import { NextRequest, NextResponse } from 'next/server';
import { getProfile, saveProfile } from '@/lib/db';

export async function GET() {
  const profile = getProfile();
  return NextResponse.json({ profile });
}

export async function PUT(request: NextRequest) {
  try {
    const data = await request.json();
    saveProfile(data);
    const profile = getProfile();
    return NextResponse.json({ profile });
  } catch (error) {
    console.error('Failed to save profile:', error);
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 });
  }
}
