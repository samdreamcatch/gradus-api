# Store submission

## Assets you need for both stores

- 1024×1024 icon, no transparency, no rounded corners
- Screenshots: iPhone 6.7" and 6.5" (iOS), phone + 7"/10" tablet (Android)
- Short description (80 chars) and full description
- Privacy policy URL (public, non-authenticated page)
- Support URL and support email

## Apple review notes that matter for this app

1. **Demo account is mandatory.** Provide a coach login and a parent login in
   App Review notes; the reviewer cannot sign up past the paywall otherwise.
2. **Payments.** Gradus subscriptions are sold to coaches and parents for use
   outside the app, and checkout happens in the system browser
   (`openExternal`), never in a webview. Explain this in review notes. If a
   reviewer pushes back, the alternatives are In-App Purchase for consumer
   subscriptions or making the app read-only about billing — do not put the
   Stripe flow back into the webview.
3. **Minimum functionality (4.2).** Emphasize native camera capture for
   schedule import, push notifications, biometric unlock, and native share —
   the app is not a bare website wrapper.
4. **Kids / minors.** Gradus collects a guardian email for under-18 athletes.
   Fill the App Privacy questionnaire accordingly, and do not enroll in the
   Kids Category (it forbids external links and third-party analytics).
5. **Account deletion (5.1.1(v))** must be reachable in-app. Confirm the
   delete-account path in settings works in the shell before submitting.

## Google Play notes

- Complete the Data safety form to match the App Privacy answers.
- Declare the app as containing user-generated content (messages) and provide
  the reporting/blocking path.
- Target API level must match Play's current requirement; bump
  `targetSdkVersion` and re-sync when Google raises it.

## Release process

```bash
bunx cap sync
bunx cap open ios      # Product → Archive → Distribute App → App Store Connect
bunx cap open android  # Build → Generate Signed Bundle (AAB) → upload to Play Console
```

Bump the version in `ios/App/App.xcodeproj` (MARKETING_VERSION / build) and
`android/app/build.gradle` (`versionName` / `versionCode`) for every upload.

Because the shell loads the hosted site, product changes ship without a store
release. Only reserve a submission for the cases listed in `README.md`.
