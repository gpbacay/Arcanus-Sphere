import type { Metadata } from "next";
import { Gate } from "@/modules/account";
import { ArScreen } from "./ArScreen";

export const metadata: Metadata = { title: "Arcanus in AR" };

// The QR code in the studio opens this page on a phone.
export default function ArPage() {
  return (
    <Gate>
      <ArScreen />
    </Gate>
  );
}
