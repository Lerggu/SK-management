import { redirect } from "next/navigation";

export default async function CompanyIndex({ params }: { params: Promise<{ companySlug: string }> }) {
  redirect(`/c/${(await params).companySlug}/dashboard`);
}
