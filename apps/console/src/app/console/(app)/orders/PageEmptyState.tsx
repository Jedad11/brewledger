"use client";

// EmptyState's action button needs onClick, which needs a client boundary --
// page.tsx (Server Component) cannot render <EmptyState action={...}/>
// directly, same reason every other page in this app (StoreLinkQR.tsx,
// MenuListClient.tsx, PaymentsSettingsForm.tsx) hands its own EmptyState
// usage off to a "use client" component rather than calling it inline.
import { useRouter } from "next/navigation";
import { EmptyState } from "@brewledger/ui";
import { PAGE_EMPTY_TITLE, PAGE_EMPTY_BODY, PAGE_EMPTY_ACTION } from "./copy";

export function PageEmptyState() {
  const router = useRouter();
  return (
    <EmptyState
      title={PAGE_EMPTY_TITLE}
      body={PAGE_EMPTY_BODY}
      action={{ label: PAGE_EMPTY_ACTION, onPress: () => router.push("/console/settings/link") }}
    />
  );
}
