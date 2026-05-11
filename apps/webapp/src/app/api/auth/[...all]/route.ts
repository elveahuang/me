import { auth } from '@/core/auth';
import { addCorsHeaders, NextJsHandler, withCors } from '@/core/utils/next.ts';
import { toNextJsHandler } from 'better-auth/next-js';
import { NextRequest, NextResponse } from 'next/server';

const handler: NextJsHandler = toNextJsHandler(auth);
export const GET = withCors(handler.GET);
export const POST = withCors(handler.POST);

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
    const headers = new Headers();
    addCorsHeaders(req, headers);
    return new NextResponse(null, {
        headers,
    });
}
