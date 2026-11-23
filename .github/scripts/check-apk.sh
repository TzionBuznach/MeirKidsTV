#!/bin/bash
# Fails the build if the APK asks for anything beyond what this app needs:
# internet access only, one activity, and nothing that can run in the background
# (no services, no boot or alarm receivers, no content providers).
set -e
APK="$1"
AAPT2=$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)aapt2
echo "== Permissions"
"$AAPT2" dump permissions "$APK" | tee /tmp/perms.txt
echo "== Components"
"$AAPT2" dump xmltree --file AndroidManifest.xml "$APK" > /tmp/manifest.txt
grep -E "E: (activity|service|receiver|provider)|A: android:name|uses-permission|action" /tmp/manifest.txt | sed 's/^ *//' > /tmp/components.txt
cat /tmp/components.txt

fail=0
# Allowed: INTERNET, ACCESS_NETWORK_STATE, and the private permission androidx declares for itself.
bad_perms=$(grep -E "uses-permission|permission:" /tmp/perms.txt | grep -vE "android.permission.INTERNET|android.permission.ACCESS_NETWORK_STATE|DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION|^package:" || true)
if [ -n "$bad_perms" ]; then echo "::error::Unexpected permissions:"; echo "$bad_perms"; fail=1; fi
if grep -qE "E: (service|provider)" /tmp/manifest.txt; then echo "::error::The APK declares a service or provider"; fail=1; fi
# Receivers: only androidx's profile installer is allowed (it only runs when asked by adb or Play).
receivers=$(awk '/E: receiver/{f=1;next} f&&/A: android:name/{print; f=0}' /tmp/manifest.txt | grep -v "androidx.profileinstaller.ProfileInstallReceiver" || true)
if [ -n "$receivers" ]; then echo "::error::Unexpected receivers:"; echo "$receivers"; fail=1; fi
if grep -qE "BOOT_COMPLETED|RECEIVE_BOOT|WAKE_LOCK|FOREGROUND_SERVICE|SCHEDULE_EXACT_ALARM" /tmp/manifest.txt /tmp/perms.txt; then echo "::error::Background or boot capability found"; fail=1; fi
[ $fail -eq 0 ] && echo "APK check passed: internet only, no background components."
exit $fail
