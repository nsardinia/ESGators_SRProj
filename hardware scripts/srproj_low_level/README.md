# SRProj Low-Level Firmware

This folder contains the PlatformIO-based embedded firmware for the Arduino Nano ESP32 mesh nodes and gateway used by ESGators.

## Contents

- `platformio.ini`: build environments for mesh nodes, gateway, radio smoke tests, and RF diagnostics.
- `src/app`: the main mesh, provisioning, configuration portal, and Firebase upload logic.
- `data/network_env.json`: fallback radio network topology used by the firmware.
- `config_page_preview.html`: static preview of the on-device setup portal UI.

## Before building

1. Review `platformio.ini` and replace the placeholder `SR_DEFAULT_DEVICE_ID` and `SR_DEFAULT_DEVICE_SECRET` values for the target environment.
2. Update the compiled defaults in `src/app/app.cpp` or override them through the device setup portal:
   - Wi-Fi SSID/password
   - backend base URL
   - Firebase API key
   - Firebase Realtime Database URL
3. Install PlatformIO and build from this folder.

## Example commands

```powershell
pio run -e mesh_node_1
pio run -e mesh_node_2
pio run -e mesh_gateway_3
```

The checked-in configuration uses placeholders so secrets are not committed to the repository.
