import type { Metadata } from "next";
import { Gate } from "@/modules/account";
import { ArScreen } from "./ArScreen";

export const metadata: Metadata = { title: "Arcanus in AR" };

// The QR code in the studio opens this page on a phone. `e` picks a saved experience; without it, world tracking.
export default async function ArPage({ searchParams }: { searchParams: Promise<{ e?: string | string[] }> }) {
  const { e } = await searchParams;
  const experienceId = Array.isArray(e) ? e[0] : e;
  return (
    <Gate>
      <ArScreen experienceId={experienceId} />
    </Gate>
  );
}
