export type SiteConfig = {
  brandFlag: boolean;
  whatsappNumber: string | null;
  reportUrl: string | null;
  privacyUrl: string | null;
};

export const siteConfig: SiteConfig = {
  /** HANDOFF §6: set to false if the team refuses the flag in the brand mark. */
  brandFlag: true,
  whatsappNumber: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || null,
  reportUrl: process.env.NEXT_PUBLIC_REPORT_URL || null,
  privacyUrl: process.env.NEXT_PUBLIC_PRIVACY_URL || null,
};
