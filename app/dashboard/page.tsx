import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { ArrowRight, Award } from "lucide-react";
import CertificatesGrid from "@/components/CertificatesGrid";

export default async function DashboardPage() {
    const session = await getServerSession(authOptions);

    const certificates = await prisma.certificate.findMany({
        where: { userId: session!.user.id },
        orderBy: { createdAt: "desc" },
    });

    const thisMonth = certificates.filter(
        c => new Date(c.createdAt).getMonth() === new Date().getMonth()
    ).length;

    return (
        <div className="space-y-8 max-w-5xl">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white">Certificates</h1>
                    <p className="text-sm text-[var(--color-neon-muted)] mt-1">
                        {certificates.length} certificate{certificates.length !== 1 ? "s" : ""} generated on your account
                    </p>
                </div>
                <Link href="/app" className="btn-primary py-2.5 px-5 flex items-center gap-2 text-sm w-fit">
                    Generate New <ArrowRight className="w-4 h-4" />
                </Link>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                    { label: "Total Generated", value: certificates.length },
                    { label: "This Month", value: thisMonth },
                    { label: "Revoked", value: certificates.filter(c => c.revoked).length },
                ].map(s => (
                    <div key={s.label} className="glass-card px-5 py-4">
                        <p className="text-xs text-[var(--color-neon-muted)] uppercase tracking-wider mb-1">{s.label}</p>
                        <p className="text-3xl font-black text-white">{s.value}</p>
                    </div>
                ))}
            </div>

            {certificates.length === 0 ? (
                <div className="glass-card flex flex-col items-center justify-center p-16 text-center border-dashed">
                    <Award className="w-12 h-12 text-[var(--color-neon-muted)] opacity-40 mb-4" />
                    <h3 className="text-lg font-bold text-white mb-2">No certificates yet</h3>
                    <p className="text-sm text-[var(--color-neon-muted)] max-w-sm mb-6">
                        Head to the generator to create your first batch from an Excel sheet.
                    </p>
                    <Link href="/app" className="btn-primary text-sm">Generate Certificates</Link>
                </div>
            ) : (
                <CertificatesGrid initialCerts={certificates} />
            )}
        </div>
    );
}
