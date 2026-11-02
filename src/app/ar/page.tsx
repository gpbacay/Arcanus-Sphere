import type { Metadata } from "next";
import { ArView } from "@/modules/sphere";

export const metadata: Metadata = { title: "Arcanus in AR" };

// The QR code in the studio opens this page on a phone.
export default function ArPage() {
  return <ArView />;
}
