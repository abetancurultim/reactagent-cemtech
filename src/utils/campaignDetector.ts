export function isFromCampaign(reqBody: any): boolean {
  const referralUrl = reqBody.ReferralSourceUrl || "";
  const referralType = reqBody.ReferralSourceType || "";
  const rawBody = reqBody.Body || "";

  console.log("🔍 Campaign Detection:");
  console.log("  - ReferralType:", referralType);
  console.log("  - ReferralUrl:", referralUrl);
  console.log("  - Body:", rawBody);

  // Método 1: Click-to-WhatsApp con utm_source=ultim
  if (referralType === "ad" && referralUrl.includes("utm_source=ultim")) {
    console.log("✅ Detectado: Click-to-WhatsApp con UTM ultim");
    return true;
  }

  // Método 2: Enlace wa.me con UTM en el texto
  if (
    rawBody.includes("utm_source=ultim") ||
    rawBody.includes("utm_medium=meta")
  ) {
    console.log("✅ Detectado: Texto con UTM de campaña");
    return true;
  }

  // Método 3: Cualquier referral type "ad" (backup)
  if (referralType === "ad") {
    console.log("✅ Detectado: Referral tipo 'ad' genérico");
    return true;
  }

  console.log("❌ No detectado como campaña");
  return false;
}

export function getCampaignOrigin(reqBody: any): string {
  if (isFromCampaign(reqBody)) {
    return "campaign";
  }
  return "organic";
}
