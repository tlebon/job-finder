import { NextRequest, NextResponse } from 'next/server';
import { getFilterRules, addFilterRule, updateFilterRule, deleteFilterRule, getBlocklist, removeFromBlocklist } from '@/lib/db';

export async function GET() {
  const rules = getFilterRules();
  const blocklist = getBlocklist();
  return NextResponse.json({ rules, blocklist });
}

export async function POST(request: NextRequest) {
  try {
    const { type, pattern, weight } = await request.json();

    if (!type || !pattern) {
      return NextResponse.json({ error: 'Type and pattern required' }, { status: 400 });
    }

    const id = addFilterRule(type, pattern, weight || 0);
    const rules = getFilterRules();
    return NextResponse.json({ id, rules });
  } catch (error) {
    console.error('Failed to add filter rule:', error);
    return NextResponse.json({ error: 'Failed to add filter rule' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { id, ...updates } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }

    updateFilterRule(id, updates);
    const rules = getFilterRules();
    return NextResponse.json({ rules });
  } catch (error) {
    console.error('Failed to update filter rule:', error);
    return NextResponse.json({ error: 'Failed to update filter rule' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const type = searchParams.get('type'); // 'rule' or 'blocklist'

    if (!id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }

    if (type === 'blocklist') {
      removeFromBlocklist(id);
    } else {
      deleteFilterRule(id);
    }

    const rules = getFilterRules();
    const blocklist = getBlocklist();
    return NextResponse.json({ rules, blocklist });
  } catch (error) {
    console.error('Failed to delete:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
