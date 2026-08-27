import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Gradus native shell.
 *
 * The webview loads the deployed site directly, so the server half of the app
 * (SSR, server functions, Stripe, webhooks) keeps running exactly as it does
 * on the web and every web deploy reaches the installed app immediately.
 *
 * `webDir` still has to exist for `cap sync`; it holds a tiny offline fallback
 * page that only shows if the device can't reach the server at launch.
 */
const config: CapacitorConfig = {
  appId: "training.gradus.app",
  appName: "Gradus",
  webDir: "native/fallback",
  server: {
    url: "https://gradus.training",
    hostname: "gradus.training",
    androidScheme: "https",
    iosScheme: "https",
    cleartext: false,
    // Everything else opens in the system browser (see openExternal in
    // src/lib/native.ts). Stripe in particular must never run in the webview.
    allowNavigation: ["gradus.training", "www.gradus.training"],
  },
  ios: {
    contentInset: "never",
    limitsNavigationsToAppBoundDomains: false,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: "#F5F6FA",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: false,
      style: "DEFAULT",
      backgroundColor: "#F5F6FA",
    },
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
