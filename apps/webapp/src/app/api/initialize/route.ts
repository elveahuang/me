import logger from '@/core/utils/logger';
import { getPayload, PayloadType } from '@/payload/utils';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest): Promise<NextResponse> {
    logger.info(`POST /api/initialize -  ${req.method} ${JSON.stringify(await req.json())}`);
    console.log(process.env.SMTP_FROM);
    console.log(process.env.SMTP_NAME);
    console.log(process.env.SMTP_HOST);
    console.log(process.env.SMTP_PORT);
    console.log(process.env.SMTP_USER);
    console.log(process.env.SMTP_PASS);
    const payload: PayloadType = await getPayload();
    await payload.sendEmail({
        to: 'ee@elvea.cn',
        subject: 'This is a test email',
        text: 'This is my message body',
    });
    return NextResponse.json({ status: 200, now: Date.now() });
}
