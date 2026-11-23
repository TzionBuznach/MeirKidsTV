#!/bin/bash
# Smoke test on an Android TV emulator: install, launch, drive with remote keys, take screenshots.
set -x
mkdir -p shots
APK=$(ls apk/*.apk | head -1)
shot() { sleep "${2:-3}"; adb exec-out screencap -p > "shots/$1.png"; }
key() { adb shell input keyevent "$@"; sleep 0.6; }
PKG=il.tzion.meirkidstv

adb shell wm size
adb shell wm density
adb install -r "$APK"
adb logcat -c

# 1) Logged out (the emulator has no account): expect our login screen.
adb shell am start -n $PKG/.MainActivity
shot 01-logged-out 35
key 23                       # OK -> login page
shot 02-login-page 20
key 4                        # Back -> home, login screen again
shot 03-back-from-login 25

# 2) Parent mode sequence (sent fast, as a person would): up up down down OK
key 19 19 20 20 23
shot 04-parent-mode 25
key 19 19 20 20 23           # and back to automatic (logged out -> login screen)
shot 05-back-to-auto 25

# 3) Kid mode without an account (test hook), to check the grids and keys.
adb shell am force-stop $PKG
adb shell am start -n $PKG/.MainActivity --ez mk_force_kids true
shot 10-home-grid 40
key 22; key 22; key 20
shot 11-home-moved 3
key 23
shot 12-series 30
key 20; key 20; key 22
shot 13-series-moved 3
key 23
shot 14-episode 30
key 4
shot 15-back-to-series 25
key 4
shot 16-back-to-home 25
key 4
shot 17-exit 5

adb logcat -d > shots/logcat-full.txt
grep -E " MKTV|FATAL EXCEPTION" shots/logcat-full.txt > shots/logcat-mk.txt || true
cat shots/logcat-mk.txt
