import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function logUsage(userId: string | null | undefined, statusCode: number, certificateId?: string) {
    if (!userId) return;
    try {
        await prisma.apiUsageLog.create({
            data: { userId, endpoint: "verify", statusCode, certificateId: certificateId ?? null },
        });
    } catch { /* non-critical */ }
}


// Allow any origin so external agents (OpenClaw, Telegram bots, etc.) can call this endpoint
export async function GET(req: NextRequest) {
    // Extract the certificate ID from the URL path directly —
    // the most reliable approach across all Next.js 15/16 versions.
    const segments = new URL(req.url).pathname.split("/");
    const id = segments[segments.length - 1];

    if (!id || id.trim() === "") {
        return NextResponse.json(
            { error: "Certificate ID is required." },
            {
                status: 400,
                headers: corsHeaders(),
            }
        );
    }

    try {
        const certificate = await prisma.certificate.findUnique({
            where: { certificateId: id.trim().toUpperCase() },
            select: {
                certificateId: true,
                name: true,
                course: true,
                issueDate: true,
                revoked: true,
            },
        });

        // 404 — certificate not found
        if (!certificate) {
            return NextResponse.json(
                { error: "Certificate not found." },
                { status: 404, headers: corsHeaders() }
            );
        }

        // Look up owner for logging
        const fullCert = await prisma.certificate.findUnique({
            where: { certificateId: id.trim().toUpperCase() },
            select: { userId: true },
        });

        // 403 — certificate has been revoked
        if (certificate.revoked) {
            void logUsage(fullCert?.userId, 403, certificate.certificateId);
            return NextResponse.json(
                { error: "This certificate has been revoked by the issuer." },
                { status: 403, headers: corsHeaders() }
            );
        }

        // 200 — valid certificate
        void logUsage(fullCert?.userId, 200, certificate.certificateId);
        return NextResponse.json(
            {
                verified: true,
                certificateId: certificate.certificateId,
                recipient: certificate.name,
                course: certificate.course,
                issuedOn: certificate.issueDate,
            },
            { status: 200, headers: corsHeaders() }
        );
    } catch (error) {
        console.error("Verification error:", error);
        return NextResponse.json(
            { error: "Internal server error. Please try again later." },
            { status: 500, headers: corsHeaders() }
        );
    }
}

// Preflight support so browsers / agents don't get blocked by CORS
export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders(): HeadersInit {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
}
