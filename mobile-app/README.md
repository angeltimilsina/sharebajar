# Sharebajar for iOS and Android

This Expo application implements the 15 requested financial screens. It uses the same market configs, valuation models, account/session endpoints and research/workspace API as the web product. Browser previews are available at /app on the Python server.

## Start

Use Node.js 20.19.4 or later (Node 22 LTS is supported).

1. Start the backend from the parent directory: `python server.py --host 0.0.0.0 --port 3000`.
2. In mobile-app: `npm install`, then `npx expo install --check`.
3. Set EXPO_PUBLIC_API_URL to your backend origin. Android emulator defaults to http://10.0.2.2:3000; iOS simulator/web defaults to http://localhost:3000. A physical device needs your computer's LAN address or a deployed HTTPS origin.
4. Run `npm start`, `npm run android`, `npm run ios` or `npm run web`.
5. Native release builds require platform signing and build tooling; iOS builds require macOS or a cloud build service.

Dependencies are pinned to the Expo SDK 55 / React Native 0.83 / React 19.2 family described in the [official SDK reference](https://docs.expo.dev/versions/v55.0.0/). Expo SecureStore stores native bearer tokens. The Expo web target uses sessionStorage. No credentials are embedded in the source.

## Screens

Onboarding, choose market, home market dashboard, search, rankings, asset detail, watchlist, portfolio import, portfolio overview, AI analysis, forecast scenarios, alerts, saved reports, pricing and profile/settings.

A simple state router keeps the prototype small. The four-tab navigation shares the web product's Markets / Research / Watchlist / Portfolio structure. Shared light design tokens and API client live in ../static/shared/financial-api.js.

Public markets work without sign-in. Private screens show a sign-in/create-account form. Plus and Pro restrictions are enforced on the server. The market choice persists locally; locale merely suggests a choice.

Portfolio imports currently use a CSV text field and demo sync. Research summaries are deterministic mock reports. Forecasts are constant-change scenarios. Alerts are checked against mock snapshots. Export uses the native share sheet. These APIs are ready for provider-backed implementations; broker sync, push delivery, payments, real AI and production authentication integrations remain external services.

The existing Capacitor shell remains in the parent project. Expo is the new native financial client and consumes the same backend, rather than bundling server-rendered SEO pages.

## Validation

Expo dependency compatibility and the web bundle have been verified. Android and iOS Hermes bytecode bundles compile; signed application binaries still need platform release tooling. The compiled web target was checked for market rankings, shared account sign-in and imported portfolio concentration.
