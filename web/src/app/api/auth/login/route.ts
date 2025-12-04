import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';

// Simple hash function for the session token
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    const correctPassword = process.env.APP_PASSWORD;

    if (!correctPassword) {
      console.error('APP_PASSWORD environment variable not set');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    if (password === correctPassword) {
      // Create a session token (hash of password + secret)
      const sessionToken = hashPassword(password + (process.env.SESSION_SECRET || 'default-secret'));

      // Set the cookie
      const cookieStore = await cookies();
      cookieStore.set('session', sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30, // 30 days
        path: '/',
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
