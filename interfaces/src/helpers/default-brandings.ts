/**
 * Platform-default branding payload. Applied by BrandingService when the
 * current route is a platform-chrome surface (login, admin, etc.) or when
 * no tenant-specific branding has been loaded.
 *
 * Keep these values aligned with the Guardian token defaults in
 * frontend/src/styles/guardian-tokens.scss — both files describe the same
 * canonical Guardian brand. Deployers wanting to white-label should change
 * both the tokens file (compile-time defaults) and these values (runtime
 * fallback shown before the user's branding payload loads).
 */
export const DefaultBrandings = {
    headerColor: '#0031ff',
    headerColor1: '#4169e2',
    primaryColor: '#4169e2',
    companyName: 'Guardian',
    companyLogoUrl: '',
    loginBannerUrl: '',
    faviconUrl: 'favicon.ico',
    termsAndConditions: '',
};
