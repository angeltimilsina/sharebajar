# Android and iOS

ShareBajar uses Capacitor 7 to bundle the existing interface into native Android and iOS projects. The Python backend runs separately on an HTTPS host; it is not bundled into the phone app. Holdings and watchlists remain on each device and are not synchronized.

## Configure and sync

Install Node 20+ and run `npm ci`. Set your deployed backend origin before every mobile build:

```powershell
$env:SHAREBAJAR_API_URL='https://your-backend.example'
npm run mobile:sync
npm run mobile:android
```

On macOS:

```sh
export SHAREBAJAR_API_URL=https://your-backend.example
npm ci
npm run mobile:sync
npm run mobile:ios
```

The URL must be an HTTPS origin without a path or credentials. The backend must serve the existing `/api/` routes. Native HTTP handles the requests. Do not put provider secrets in the bundle. The placeholder `https://api.example.com` used during build verification is not a functioning backend; rebuild and sync with a real URL before device testing or distribution.

The portfolio dashboard also requires `/api/news?market=...` from the updated backend and outgoing access to `news.google.com` for sourced market headlines. Default market preferences stay on the device with the portfolio backup data.

## Android

Open `android/` in Android Studio with SDK 35 and JDK 21+. Run on an emulator or USB-connected phone, or build a debug APK:

```powershell
cd android
.\gradlew.bat assembleDebug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`. For Play Store distribution, configure your own signing key and produce a signed Android App Bundle. The current application ID is `com.sharebajar.app`; change it before first publication if needed.

## iOS

iOS compilation needs macOS, Xcode, and CocoaPods. Run `npm run mobile:sync` on the Mac to install native dependencies, then open `ios/App/App.xcworkspace`. Select your signing team and device, and run. Archive a signed release for TestFlight or App Store distribution. An IPA cannot be compiled on Windows.

## Device checks before release

- Verify catalog, search, quotes, crypto and charts against your real backend, including connection failures.
- Record a holding and watchlist item, terminate and reopen, then verify persistence.
- Export through the native share sheet and import the saved JSON backup through the file picker.
- Check Android back closes dialogs, returns to Overview, and exits from Overview.
- Check notch/home indicator spacing, keyboard input, small screens and landscape on both platforms.

The native projects currently use the generated launcher and splash assets. Add final branding, screenshots, privacy disclosures, provider licensing, and store metadata before publishing. Uninstalling the app can remove locally stored portfolios; export backups regularly.
