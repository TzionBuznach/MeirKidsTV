package il.tzion.meirkidstv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

/**
 * A thin TV wrapper around meirkids.co.il.
 * All the kid-friendly behaviour (remote navigation, auto full screen,
 * next-episode countdown) lives in assets/inject.js, which runs inside the site.
 */
public class MainActivity extends Activity {

    private static final String TAG = "MKTV";
    private static final String HOME_URL = "https://meirkids.co.il/";
    private static final String ERROR_URL = "file:///android_asset/offline.html";
    // A desktop user agent keeps the site on the same layout that inject.js was written against.
    private static final String DESKTOP_UA =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/124.0.0.0 Safari/537.36 MeirKidsTV/1.0";

    private FrameLayout root;
    private WebView webView;
    private View customView;
    private WebChromeClient chromeClient;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private String injectJs = "";
    private boolean documentStartScriptInstalled = false;
    // True while a page is in kid mode. Then every remote key is caught here, before the
    // WebView, and handed to inject.js directly, so nothing inside the page (like the video
    // frame) can swallow it.
    private volatile boolean kidMode = false;
    // Parent mode is switched with a key sequence a kid will not hit by accident: up up down down OK.
    private static final String[] PARENT_SEQUENCE = {"up", "up", "down", "down"};
    private static final long SEQUENCE_WINDOW_MS = 6000;
    private final String[] recentKeys = new String[4];
    private final long[] recentTimes = new long[4];
    private boolean sequenceEnterPending = false;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        injectJs = readAsset("inject.js");
        if (getIntent() != null && getIntent().getBooleanExtra("mk_force_kids", false)) {
            // Test hook for the emulator, which has no subscription: kid mode without logging in.
            injectJs = "window.__mkForceKids=true;" + injectJs;
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#1b0b2e"));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#1b0b2e"));
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.requestFocus();

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // lets episodes start by themselves
        s.setUserAgentString(DESKTOP_UA);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new NativeBridge(), "MKNative");

        // Preferred: run inject.js before the site's own scripts, so the raw site never flashes.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            try {
                WebViewCompat.addDocumentStartJavaScript(webView, injectJs,
                        Collections.singleton("https://meirkids.co.il"));
                documentStartScriptInstalled = true;
            } catch (Exception ignored) {
                documentStartScriptInstalled = false;
            }
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri uri = request.getUrl();
                String host = uri.getHost() == null ? "" : uri.getHost();
                // Stay inside the channel. Everything else (forms, YouTube, social) is ignored.
                boolean allowed = host.equals("meirkids.co.il") || host.endsWith(".meirkids.co.il");
                return !allowed;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                kidMode = false; // the new page will switch it back on when it is ready
                Log.i(TAG, "page started " + url);
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                super.onPageCommitVisible(view, url);
                // Older WebViews without document-start scripts: inject as soon as the page shows.
                injectFallback(view, url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                Log.i(TAG, "page finished " + url + " docStartScript=" + documentStartScriptInstalled);
                injectFallback(view, url); // inject.js guards against running twice
                CookieManager.getInstance().flush();
            }

            private void injectFallback(WebView view, String url) {
                if (documentStartScriptInstalled || url == null) return;
                if ("meirkids.co.il".equals(Uri.parse(url).getHost())) {
                    view.evaluateJavascript(injectJs, null);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    Log.w(TAG, "load error " + request.getUrl() + " " + error.getDescription());
                    view.loadUrl(ERROR_URL);
                }
            }
        });

        chromeClient = new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i(TAG, "console " + m.message());
                return true;
            }

            @Override
            public Bitmap getDefaultVideoPoster() {
                // Removes the grey "play" placeholder Android draws before a video starts.
                return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            }

            @Override
            public void onHideCustomView() {
                if (customView != null) {
                    root.removeView(customView);
                    customView = null;
                }
                if (customViewCallback != null) {
                    customViewCallback.onCustomViewHidden();
                    customViewCallback = null;
                }
            }
        };
        webView.setWebChromeClient(chromeClient);

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(HOME_URL);
        }
    }

    /** Maps every key a TV remote may send for the same button to one name. */
    private static String remoteKey(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP: return "up";
            case KeyEvent.KEYCODE_DPAD_DOWN: return "down";
            case KeyEvent.KEYCODE_DPAD_LEFT: return "left";
            case KeyEvent.KEYCODE_DPAD_RIGHT: return "right";
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
            case KeyEvent.KEYCODE_BUTTON_A:
                return "enter";
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                return "playpause";
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: return "right";
            case KeyEvent.KEYCODE_MEDIA_REWIND: return "left";
            default: return null;
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        int action = event.getAction();
        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ESCAPE) {
            if (action == KeyEvent.ACTION_UP) {
                handleBack();
            }
            return true;
        }

        String name = remoteKey(code);
        if (name == null) return super.dispatchKeyEvent(event);
        if (action == KeyEvent.ACTION_DOWN) Log.i(TAG, "key " + name + " kidMode=" + kidMode);

        // Parent mode switch: up up down down, then OK, within 4 seconds. Works in both modes.
        if (name.equals("enter")) {
            if (action == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0 && sequenceMatches(event.getEventTime())) {
                sequenceEnterPending = true;
                return true;
            }
            if (sequenceEnterPending) {
                if (action == KeyEvent.ACTION_UP) {
                    sequenceEnterPending = false;
                    clearSequence();
                    runJs("window.__mk&&window.__mk.toggleParent&&window.__mk.toggleParent()");
                }
                return true;
            }
        } else if (action == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
            rememberKey(name, event.getEventTime());
        }

        if (!kidMode) return super.dispatchKeyEvent(event); // parent mode: normal browsing

        if (name.equals("enter")) {
            // Act on release, so a long hold is not also a click.
            if (action == KeyEvent.ACTION_UP) runJs("window.__mk&&window.__mk.key&&window.__mk.key('enter')");
            return true;
        }
        if (action == KeyEvent.ACTION_DOWN) {
            runJs("window.__mk&&window.__mk.key&&window.__mk.key('" + name + "')");
        }
        return true;
    }

    private void rememberKey(String name, long time) {
        System.arraycopy(recentKeys, 1, recentKeys, 0, recentKeys.length - 1);
        System.arraycopy(recentTimes, 1, recentTimes, 0, recentTimes.length - 1);
        recentKeys[recentKeys.length - 1] = name;
        recentTimes[recentTimes.length - 1] = time;
    }

    private boolean sequenceMatches(long now) {
        for (int i = 0; i < PARENT_SEQUENCE.length; i++) {
            if (!PARENT_SEQUENCE[i].equals(recentKeys[i])) return false;
        }
        return now - recentTimes[0] <= SEQUENCE_WINDOW_MS;
    }

    private void clearSequence() {
        for (int i = 0; i < recentKeys.length; i++) recentKeys[i] = null;
    }

    private void runJs(String js) {
        webView.evaluateJavascript("(function(){try{" + js + "}catch(e){}})()", null);
    }

    private void handleBack() {
        if (customView != null) {
            chromeClient.onHideCustomView();
            return;
        }
        String url = webView.getUrl();
        String host = url == null ? "" : Uri.parse(url).getHost();
        if (url != null && (url.startsWith("file:") || !"meirkids.co.il".equals(host))) {
            // Offline page, or the login site (join.meirkids.co.il): Back goes to the channel home,
            // which also re-checks the login and switches to kid mode once logged in.
            webView.loadUrl(HOME_URL);
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{return (window.__mk&&window.__mk.back)?window.__mk.back():'none'}catch(e){return 'none'}})()",
                value -> {
                    if (value != null && value.contains("handled")) return;
                    if (value != null && value.contains("exit")) {
                        finish();
                        return;
                    }
                    if (webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        finish();
                    }
                });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
        webView.onPause();      // stops the episode when the kid leaves the app
        webView.pauseTimers();  // and stops all page scripts and timers until the app is back
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.resumeTimers();
        webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
        }
        super.onDestroy();
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return "";
        }
    }

    /** Small bridge used by inject.js. Only touches the screen-on flag and app exit. */
    private class NativeBridge {
        @JavascriptInterface
        public void setKeepScreenOn(final boolean on) {
            runOnUiThread(() -> {
                if (on) {
                    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }

        @JavascriptInterface
        public void setKidMode(boolean on) {
            kidMode = on;
        }

        @JavascriptInterface
        public void reloadHome() {
            runOnUiThread(() -> webView.loadUrl(HOME_URL));
        }
    }
}
