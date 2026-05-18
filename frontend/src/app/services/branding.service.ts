import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { colorToGradient } from '../static/color-remoter.function';
import { disableGlobalLoader } from '../static/global-loader.function';
import { DefaultBrandings } from '@guardian/interfaces';

export interface BrandingPayload {
    headerColor: string
    headerColor1: string
    primaryColor: string
    companyName: string
    companyLogoUrl: string
    loginBannerUrl: string
    faviconUrl: string,
    termsAndConditions: string
}

/*
 * Route prefixes that always render the platform's default brand,
 * regardless of any tenant branding currently loaded. Use this for
 * platform-chrome surfaces (super-admin panels, public auth flows,
 * system pages, the branding settings screen itself) so a tenant's
 * custom brand never leaks into UI that operators consider "the
 * platform's own chrome."
 *
 * Deployers can extend or replace this list to match their own product
 * structure. End-user / tenant-workspace routes are everything NOT in
 * this list.
 */
export const PLATFORM_CHROME_ROUTE_PREFIXES: string[] = [
    '/admin',
    '/branding',
    '/login',
    '/register',
    '/sso',
];

export function isPlatformChromeRoute(url: string, prefixes: string[] = PLATFORM_CHROME_ROUTE_PREFIXES): boolean {
    const path = (url || '').split('?')[0].split('#')[0];
    return prefixes.some((prefix) =>
        path === prefix || path.startsWith(prefix + '/')
    );
}

/*
 * Roles whose users are platform operators (not tenant end-users). They
 * always see platform-default branding regardless of which route they're
 * on, since most operator routes are also legitimately used by end-users
 * with their own tenant brand. Gating by role rather than route prevents
 * accidentally locking end-users out of their brand on shared routes.
 */
export const PLATFORM_CHROME_ROLES: string[] = [
    'AUDITOR',
    'ADMIN',
];

export function isPlatformChromeRole(role: string | null | undefined, roles: string[] = PLATFORM_CHROME_ROLES): boolean {
    return !!role && roles.includes(role);
}

@Injectable({
    providedIn: 'root'
})
export class BrandingService {
    private brandingData: BrandingPayload = {
        headerColor: '',
        headerColor1: '',
        primaryColor: '',
        companyName: '',
        companyLogoUrl: '',
        loginBannerUrl: '',
        faviconUrl: '',
        termsAndConditions: '',
    };

    constructor(
        private http: HttpClient
    ) {
    }

    get termsAndConditions(): string {
        return this.brandingData.termsAndConditions;
    }

    saveBrandingData(payload: any): boolean {
        // send POST request to server
        this.http.post('/api/v1/branding', payload).subscribe(
            (response: any) => {
                console.log('Variables saved successfully', response);
                location.reload();
            },
            (error: any) => {
                console.error(error);
                return false;
            }
        );
        return true;
    }

    getBrandingData(): Promise<BrandingPayload> {
        // send GET request
        return this.http.get('/api/v1/branding')
            .toPromise()
            .then((data: any) => {
                this.brandingData = data;
                return this.brandingData as BrandingPayload;
            })
            .catch((error: any) => {
                console.log(error)
                return this.brandingData;
            });
    }

    loadBrandingData(width?: number): Promise<BrandingPayload> {
        // send GET request
        return this.getBrandingData()
            .then((data: any) => {
                this.brandingData = data as any;
                this.applyBranding(this.brandingData);
                return data
            })
            .catch((error: any) => {
                console.log(error)
                return this.brandingData;
            });
    }

    /**
     * Apply the platform-default branding payload. Used on platform-chrome
     * routes (login, admin, etc.) and as a safe fallback when no
     * tenant-specific branding has loaded yet.
     */
    applyDefaultBranding(): void {
        this.applyBranding(DefaultBrandings);
    }

    /**
     * Apply the currently loaded tenant-specific branding payload, if any.
     * No-op when nothing has been loaded yet — caller should use
     * applyDefaultBranding() in that case.
     */
    applyStoredBranding(): void {
        if (this.brandingData && this.brandingData.primaryColor) {
            this.applyBranding(this.brandingData);
        }
    }

    /**
     * Pick the right branding based on the current route + current user
     * role. Platform-chrome routes (admin, login, etc.) and platform-
     * operator roles always see DefaultBrandings; everything else gets
     * the tenant's stored brand.
     *
     * Deployers can hook into this method to refresh branding on
     * navigation or session changes.
     */
    applyBrandingForRoute(url: string, role?: string | null): void {
        if (isPlatformChromeRoute(url) || isPlatformChromeRole(role)) {
            this.applyDefaultBranding();
        } else {
            this.applyStoredBranding();
        }
    }

    /**
     * Set the primary-colour CSS variables on document.body. Extracted as
     * a public helper so the branding settings Preview pane can apply the
     * same overrides faithfully — without this, the preview wrote only
     * --color-primary and missed --primary-color / --button-primary-color
     * which token-driven components read.
     */
    public applyPrimaryColor(primaryColor: string | null | undefined): void {
        if (primaryColor) {
            document.body.style.setProperty('--color-primary', primaryColor);
            document.body.style.setProperty('--primary-color', primaryColor);
            document.body.style.setProperty('--button-primary-color', primaryColor);
            document.body.style.setProperty('--primary-primary', primaryColor);
        } else {
            document.body.style.removeProperty('--color-primary');
            document.body.style.removeProperty('--primary-color');
            document.body.style.removeProperty('--button-primary-color');
            document.body.style.removeProperty('--primary-primary');
        }
    }

    /**
     * Set the header gradient CSS variable on document.body from two
     * stops. Extracted alongside applyPrimaryColor so preview and
     * production paths share one implementation.
     */
    public applyHeaderGradient(headerColor: string | null | undefined, headerColor1: string | null | undefined): void {
        if (headerColor && headerColor1) {
            const gradientData = colorToGradient(headerColor, headerColor1);
            document.body.style.setProperty('--linear-gradient', gradientData);
        } else {
            document.body.style.removeProperty('--linear-gradient');
        }
    }

    private applyBranding(brandingData: any) {
        try {
            const favicon = document.querySelectorAll<HTMLLinkElement>('link[rel="shortcut icon"],link[rel="icon"]');
            const loginBanner = document.querySelector<HTMLElement>('.background')!;
            const companyLogo = (document.getElementById('company-logo') as HTMLImageElement)!;
            const companyName = document.getElementById('company-name')!;

            this.applyPrimaryColor(brandingData.primaryColor);
            this.applyHeaderGradient(brandingData.headerColor, brandingData.headerColor1);

            if (brandingData.companyName) {
                if (companyName) {
                    companyName.innerHTML = brandingData.companyName;
                }
                document.title = brandingData.companyName;
            }
            if (companyLogo) {
                companyLogo.style.display = 'none';
                if (brandingData.companyLogoUrl) {
                    companyLogo.style.display = 'block';
                    companyLogo.src = brandingData.companyLogoUrl;
                }
            }
            if (favicon[0]) {
                if (brandingData.faviconUrl) {
                    favicon[0].href = brandingData.faviconUrl;
                } else if (brandingData.companyLogoUrl) {
                    favicon[0].href = brandingData.companyLogoUrl;
                }
            }
        } finally {
            disableGlobalLoader();
        }
    }
}
