import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { generateCertificate } from "@/lib/generateCertificate";
import { uploadToS3 } from "@/lib/s3";

export const dynamic = "force-dynamic";

const corsHeaders: HeadersInit = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function generateCertId(): string {
    const buf = new Uint8Array(4);
    crypto.getRandomValues(buf);
    return "CERT-" + Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export async function POST(req: NextRequest) {
    // ── 1. Authenticate via API key ──────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const apiKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!apiKey) {
        return NextResponse.json(
            { error: "Missing Authorization header. Use: Authorization: Bearer <your_api_key>" },
            { status: 401, headers: corsHeaders }
        );
    }

    const owner = await prisma.user.findUnique({
        where: { apiKey },
        select: { id: true },
    });

    if (!owner) {
        return NextResponse.json(
            { error: "Invalid API key." },
            { status: 401, headers: corsHeaders }
        );
    }

    // ── 2. Parse & validate request body ────────────────────────────────
    let body: { recipient?: string; course?: string; issueDate?: string; templateUrl?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { error: "Invalid JSON body." },
            { status: 400, headers: corsHeaders }
        );
    }

    const { recipient, course, issueDate, templateUrl } = body;

    if (!recipient || !course || !issueDate || !templateUrl) {
        return NextResponse.json(
            { error: "Missing required fields: recipient, course, issueDate, templateUrl" },
            { status: 400, headers: corsHeaders }
        );
    }

    // ── 3. Fetch the PDF template ────────────────────────────────────────
    let templateBuffer: ArrayBuffer;
    try {
        const templateRes = await fetch(templateUrl);
        if (!templateRes.ok) {
            return NextResponse.json(
                { error: `Failed to fetch templateUrl (HTTP ${templateRes.status}). Make sure the URL is publicly accessible.` },
                { status: 422, headers: corsHeaders }
            );
        }
        templateBuffer = await templateRes.arrayBuffer();
    } catch {
        return NextResponse.json(
            { error: "Could not reach templateUrl. Ensure it is a valid, publicly accessible PDF URL." },
            { status: 422, headers: corsHeaders }
        );
    }

    // ── 4. Generate the certificate PDF ─────────────────────────────────
    const certificateId = generateCertId();

    const protocol = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("host") ?? "vurakit.vercel.app";
    const baseUrl = `${protocol}://${host}`;

    const certData = {
        name: recipient,
        course,
        issueDate,
        certificateId,
    };

    let pdfBuffer: Buffer;
    try {
        pdfBuffer = await generateCertificate(templateBuffer, certData, undefined, baseUrl);
    } catch (err) {
        console.error("Certificate generation error:", err);
        return NextResponse.json(
            { error: "Failed to generate certificate PDF. Check that the templateUrl points to a valid PDF file." },
            { status: 500, headers: corsHeaders }
        );
    }

    // ── 5. Upload PDF to S3 ──────────────────────────────────────────────
    let pdfUrl: string;
    try {
        pdfUrl = await uploadToS3(pdfBuffer, `certificates/${certificateId}.pdf`);
    } catch (err) {
        console.error("S3 upload error:", err);
        return NextResponse.json(
            { error: "Failed to upload certificate to storage." },
            { status: 500, headers: corsHeaders }
        );
    }

    // ── 6. Save to database ──────────────────────────────────────────────
    await prisma.certificate.create({
        data: {
            certificateId,
            name: recipient,
            course,
            issueDate,
            templateUrl,
            pdfUrl,
            userId: owner.id,
        },
    });

    // ── 7. Log API usage ─────────────────────────────────────────────────
    try {
        await prisma.apiUsageLog.create({
            data: { userId: owner.id, endpoint: "create", statusCode: 201, certificateId },
        });
    } catch { /* non-critical */ }

    // ── 8. Return response ───────────────────────────────────────────────
    return NextResponse.json(
        {
            success: true,
            certificateId,
            pdfUrl,
            verifyUrl: `${baseUrl}/verify/${certificateId}`,
        },
        { status: 201, headers: corsHeaders }
    );
}
