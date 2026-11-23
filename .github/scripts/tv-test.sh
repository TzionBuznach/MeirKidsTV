#!/bin/bash
# Smoke test on an Android TV emulator: install, launch, drive with remote keys, take screenshots.
set -x
mkdir -p shots
APK=$(ls apk/*.apk | head -1)
shot() { sleep "${2:-3}"; adb exec-out screencap -p > "shots/$1.png"; }
key() { adb shell input keyevent "$1"; sleep 0.6; }

adb shell wm size
adb shell wm density
adb shell dumpsys package com.google.android.webview | grep -m1 versionName
adb shell dumpsys package com.android.webview | grep -m1 versionName
adb install -r "$APK"
adb logcat -c
adb shell am start -n il.tzion.meirkidstv/.MainActivity
shot 01-first-launch 30

# Not logged in in the emulator: expect the plain site with the login banner.
# Switch to kid mode with the parent sequence: up up down down OK.
key 19; key 19; key 20; key 20; key 23
shot 02-after-sequence 25

# Home grid: move right, right, down.
key 22; key 22; key 20
shot 03-home-moved 3
key 21
key 23
shot 04-series 25
key 20; key 20; key 22
shot 05-series-moved 3

# Open an episode (no subscription here, so it will not play; checks the screen does not break).
key 23
shot 06-episode 25

# Back: episode -> series -> home.
key 4
shot 07-back-to-series 20
key 4
shot 08-back-to-home 20

# Parent mode again with the sequence, then back to kids.
key 19; key 19; key 20; key 20; key 23
shot 09-parent-mode 15

adb logcat -d > shots/logcat-full.txt
grep -E " MKTV|FATAL EXCEPTION|il.tzion" shots/logcat-full.txt > shots/logcat-mk.txt || true
cat shots/logcat-mk.txt
