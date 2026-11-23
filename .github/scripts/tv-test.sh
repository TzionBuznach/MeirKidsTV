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
adb shell am start -n $PKG/.MainActivity --ez mk_debug true
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
adb shell am start -n $PKG/.MainActivity --ez mk_force_kids true --ez mk_debug true
shot 10-home-grid 40
key 22; key 22; key 20
shot 11-home-moved 3
key 23
shot 12-series 30
key 20; key 20; key 22
shot 13-series-moved 3
key 23
shot 14-episode 30
shot 14b-episode-later 20
key 23                       # OK: pause
shot 14c-paused 3
key 22                       # right: +10 s
shot 14d-seek 2
key 23                       # OK: play again
shot 14e-playing 5
key 4
shot 15-back-to-series 25
key 4
shot 16-back-to-home 25
key 4
shot 17-exit 5

adb logcat -d > shots/logcat-full.txt
grep -E " MKTV|FATAL EXCEPTION" shots/logcat-full.txt > shots/logcat-mk.txt || true
cat shots/logcat-mk.txt

# ---------------------------------------------------------------------------
# 4) Resource check: does the app use CPU or network when it is not on screen?
# CPU: the app's own process, and separately the WebView page renderers (a separate process).
# Network: per app (Android's own per-UID traffic counters), so other apps' traffic is not blamed on us.
R=shots/resource-report.txt
APPUID=$(adb shell pm list packages -U $PKG | tr -d '\r' | sed -n 's/.*uid:\([0-9]*\).*/\1/p' | head -1)
adb shell pm list packages -U | tr -d '\r' | sed -n 's/package:\(.*\) uid:\([0-9,]*\).*/\2 \1/p' > /tmp/uids.txt
cpu() { local pid; pid=$(adb shell pidof $PKG | tr -d '\r'); if [ -z "$pid" ]; then echo "-"; else adb shell cat /proc/$pid/stat | tr -d '\r' | awk '{print $14+$15}'; fi; }
rcpu() { for p in $(adb shell ps -A -o PID,NAME | tr -d '\r' | awk '/sandboxed_process|privileged_process/ {print $1}'); do adb shell cat /proc/$p/stat 2>/dev/null; done | tr -d '\r' | awk '{s+=$14+$15} END {print s+0}'; }
uidnet() { # prints "uid bytes" for every app, after forcing Android to update its counters
  adb shell dumpsys netstats --poll >/dev/null 2>&1
  adb shell dumpsys netstats detail | tr -d '\r' | awk '
    /uid=-?[0-9]+ set=[A-Z_]+ tag=0x0/ { match($0, /uid=-?[0-9]+/); cur=substr($0, RSTART+4, RLENGTH-4); next }
    /uid=-?[0-9]+ set=/ { cur=""; next }
    /^ *(Dev|Xt|UID|UID tag) stats/ { cur="" }
    / rb=/ && cur!="" { for (i=1;i<=NF;i++) { if ($i ~ /^rb=/ || $i ~ /^tb=/) { split($i, a, "="); t[cur]+=a[2] } } }
    END { for (u in t) print u, t[u] }'
}
devnet() { adb shell cat /proc/net/dev | tr -d '\r' | awk -F'[: ]+' 'NR>2 && $2!="lo" {rx+=$3; tx+=$11} END {print rx+tx}'; }
phase() { # name seconds
  local c0 r0 n0 c1 r1 n1
  c0=$(cpu); r0=$(rcpu); n0=$(devnet); uidnet > /tmp/u0.txt
  sleep "$2"
  c1=$(cpu); r1=$(rcpu); n1=$(devnet); uidnet > /tmp/u1.txt
  local alive="yes"; [ -z "$(adb shell pidof $PKG | tr -d '\r')" ] && alive="no"
  local dc="-"; [ "$c0" != "-" ] && [ "$c1" != "-" ] && dc=$(awk -v a=$c0 -v b=$c1 'BEGIN{printf "%.2f s", (b-a)/100}')
  local dr=$(awk -v a=$r0 -v b=$r1 'BEGIN{d=(b-a)/100; if (d<0) d=0; printf "%.2f s", d}')
  local app0=$(awk -v u=$APPUID '$1==u{print $2}' /tmp/u0.txt); local app1=$(awk -v u=$APPUID '$1==u{print $2}' /tmp/u1.txt)
  local dapp=$(( (${app1:-0} - ${app0:-0}) / 1024 ))
  local ddev=$(( (n1 - n0) / 1024 ))
  local top=$(join <(sort /tmp/u0.txt) <(sort /tmp/u1.txt) -a2 -e0 -o 0,1.2,2.2 | awk '{d=$3-$2; if (d>0) print d, $1}' | sort -rn | head -3 | while read d u; do n=$(awk -v u=$u '$1==u{print $2; exit}' /tmp/uids.txt); echo -n "${n:-uid $u}=$((d/1024))KB "; done)
  echo "$1 | ${2}s | app CPU $dc | page renderer CPU $dr | app network ${dapp} KB | whole device ${ddev} KB | alive: $alive | top network users: ${top:-none}" | tee -a $R
}
echo "app uid: $APPUID" > $R
echo "phase | duration | app CPU | renderer CPU | app network | whole device | alive | top users" >> $R

adb shell am force-stop $PKG
adb shell input keyevent 224; sleep 2
adb shell am start -n $PKG/.MainActivity --ez mk_force_kids true --ez mk_debug true
sleep 40
phase "A. app open on the home grid (idle)" 60
adb shell input keyevent 3            # Home: app goes to the background
sleep 5
phase "B. app in the background" 120
adb shell input keyevent 223          # screen off (sleep)
sleep 5
phase "C. screen off, app was last used" 120
adb shell input keyevent 224; sleep 3
adb shell am force-stop $PKG
adb shell input keyevent 223
sleep 5
phase "D. baseline: screen off, app stopped" 120
adb shell input keyevent 224
echo "== wake locks held by the app (should be none):" | tee -a $R
adb shell dumpsys power | tr -d '\r' | grep -i "$PKG" | tee -a $R || true
echo "== netstats sample (format check):" >> $R
adb shell dumpsys netstats detail | tr -d '\r' | grep -m5 -A2 "uid=$APPUID set=DEFAULT tag=0x0" >> $R || true
cat $R
