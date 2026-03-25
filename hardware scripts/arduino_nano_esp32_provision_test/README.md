# Arduino Nano ESP32 provisioning and Firebase telemetry test

This sketch performs the full device bootstrap flow:

- `POST /devices/provision`
- Request body:
  - `deviceId`
  - `deviceSecret`
- Success response:
  - `firebaseCustomToken`
  - `firebaseUid`
  - `deviceId`
- Exchange the custom token for a Firebase ID token
- Write telemetry to Firebase Realtime Database under `/devices/{deviceId}/latest`

Backend reference:

- [mwbe/src/routes/devices.js](/home/nicholas/srproj/ESGators_SRProj/mwbe/src/routes/devices.js#L280)

## How to use

1. Open `arduino_nano_esp32_provision_test.ino` in Arduino IDE.
2. Install the `ArduinoJson` library in Library Manager.
3. Set:
   - `WIFI_SSID`
   - `WIFI_PASSWORD`
   - `BACKEND_BASE_URL`
   - `DEVICE_ID`
   - `DEVICE_SECRET`
   - `FIREBASE_API_KEY`
   - `FIREBASE_DATABASE_URL`
4. Upload to an Arduino Nano ESP32.
5. Open Serial Monitor at `115200`.

## Notes

- For local HTTPS testing with a self-signed or otherwise untrusted certificate, `ALLOW_INSECURE_TLS = true` will skip certificate validation.
- For production, replace that with proper certificate validation.
- This sketch uses Firebase REST endpoints, so it does not require a separate Firebase Arduino SDK.
- The Firebase API key here is the normal client-side web API key, not the admin service account key.
- The sketch refreshes the Firebase ID token when it is near expiry.
