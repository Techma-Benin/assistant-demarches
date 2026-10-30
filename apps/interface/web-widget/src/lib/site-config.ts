export type SiteConfig = {
  flagGreeting: boolean;
  whatsappNumber: string | null;
  reportUrl: string | null;
  privacyUrl: string | null;
};

export const siteConfig: SiteConfig = {
  /** HANDOFF §6: set to false if the team refuses "Bonjour, Bénin." + flag; the hero then reads « Bonjour ! » and BrandMark hides the flag. */
  flagGreeting: true,
  whatsappNumber: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || null,
  reportUrl: process.env.NEXT_PUBLIC_REPORT_URL || null,
  privacyUrl: process.env.NEXT_PUBLIC_PRIVACY_URL || null,
};
