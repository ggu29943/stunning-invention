package com.heelstomp.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Rect;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.DisplayCutout;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 高跟踩蚂蚁 as an app: one full-screen landscape WebView running the web game,
 * which is bundled in the APK (assets/www, filled by tools/build_apk.sh).
 */
public class MainActivity extends Activity {
    private static final String TAG = "HeelStomp";
    /**
     * The game is served from this reserved host (it never resolves on the
     * network), so it gets a real https origin: ES modules, fetch() and
     * localStorage work exactly as on the web site, none of them from file://.
     */
    static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final int BG = 0xFF07030B;
    /** Oldest WebView the game runs on (Chromium 87: CSS inset, ||= in JS). */
    private static final int MIN_CHROMIUM = 87;

    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("mjs", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("webp", "image/webp");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("svg", "image/svg+xml");
        MIME.put("ico", "image/x-icon");
        MIME.put("wav", "audio/wav");
        MIME.put("mp3", "audio/mpeg");
        MIME.put("ogg", "audio/ogg");
        MIME.put("woff2", "font/woff2");
    }

    private WebView web;
    private boolean pageLoaded;
    /** Camera-cutout insets in CSS px (= dp): top, right, bottom, left. */
    private final float[] insets = new float[4];

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // the volume buttons set the game's sound volume (not the ringer's)
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        Window win = getWindow();
        win.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            // use the whole screen, camera cutout included; the page keeps its
            // buttons clear of it (--app-inset-*, see pushInsets)
            WindowManager.LayoutParams lp = win.getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            win.setAttributes(lp);
        }
        if (Build.VERSION.SDK_INT >= 30) win.setDecorFitsSystemWindows(false);
        if (BuildConfig.WEB_DEBUG) WebView.setWebContentsDebuggingEnabled(true);

        web = new WebView(this);
        web.setBackgroundColor(BG);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setHapticFeedbackEnabled(false);
        // a held finger charges a stomp: no text selection or context menu
        web.setLongClickable(false);
        web.setOnLongClickListener(v -> true);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // settings and records live in localStorage
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100); // menus are laid out for 100 %, whatever the system font size
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        web.setWebViewClient(new GameClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i(TAG, "console " + m.messageLevel() + ": " + m.message()
                        + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });
        web.setOnApplyWindowInsetsListener((v, wi) -> {
            readCutout(wi);
            return v.onApplyWindowInsets(wi);
        });
        web.addOnLayoutChangeListener((v, left, top, right, bottom, ol, ot, or, ob) ->
                keepEdgesForGame(right - left, bottom - top));

        setContentView(web);
        hideSystemBars();
        web.loadUrl(START_URL);

        warnIfWebViewTooOld();
        checkForUpdate();
    }

    // ------------------------------------------------------------ screen

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    /** The camera cutout's safe insets, handed to the page (in CSS px). */
    private void readCutout(WindowInsets wi) {
        float[] next = new float[4];
        if (Build.VERSION.SDK_INT >= 28) {
            DisplayCutout c = wi.getDisplayCutout();
            if (c != null) {
                float d = getResources().getDisplayMetrics().density;
                next[0] = c.getSafeInsetTop() / d;
                next[1] = c.getSafeInsetRight() / d;
                next[2] = c.getSafeInsetBottom() / d;
                next[3] = c.getSafeInsetLeft() / d;
            }
        }
        if (Arrays.equals(next, insets)) return;
        System.arraycopy(next, 0, insets, 0, 4);
        pushInsets();
    }

    /** --app-inset-* on the page (style.css takes the larger of these and env()). */
    private void pushInsets() {
        if (!pageLoaded || web == null) return;
        String[] side = {"top", "right", "bottom", "left"};
        StringBuilder js = new StringBuilder("(function(s){");
        for (int i = 0; i < 4; i++) {
            js.append("s.setProperty('--app-inset-").append(side[i]).append("','")
                    .append(String.format(Locale.ROOT, "%.1f", insets[i])).append("px');");
        }
        js.append("window.dispatchEvent(new Event('resize'));})(document.documentElement.style)");
        web.evaluateJavascript(js.toString(), null);
    }

    /**
     * Gesture navigation (Android 10+): a swipe in from the left or right edge
     * means "back". Keep the lower part of both edges for the game, where the
     * boot works the street (the system allows at most 200 dp per edge).
     */
    private void keepEdgesForGame(int w, int h) {
        if (Build.VERSION.SDK_INT < 29 || web == null || w <= 0 || h <= 0) return;
        float d = getResources().getDisplayMetrics().density;
        int edge = Math.round(48 * d);
        int tall = Math.min(h, Math.round(200 * d));
        List<Rect> rects = new ArrayList<>();
        rects.add(new Rect(0, h - tall, edge, h));
        rects.add(new Rect(w - edge, h - tall, w, h));
        web.setSystemGestureExclusionRects(rects);
    }

    // ------------------------------------------------------------ lifecycle

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        hideSystemBars();
    }

    @Override
    protected void onPause() {
        // the page sees visibilitychange (hidden): a round in progress pauses
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        dropWebView();
        super.onDestroy();
    }

    private void dropWebView() {
        if (web == null) return;
        ViewGroup parent = (ViewGroup) web.getParent();
        if (parent != null) parent.removeView(web);
        web.destroy();
        web = null;
    }

    /** Back: the game closes 设置 / pauses / resumes first; on the main menu the app goes to the background. */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (!pageLoaded || web == null) {
            moveTaskToBack(true);
            return;
        }
        web.evaluateJavascript(
                "(function(){try{return !!(window.heelstompBack&&window.heelstompBack());}catch(e){return false;}})()",
                handled -> {
                    if (!"true".equals(handled)) moveTaskToBack(true);
                });
    }

    // ------------------------------------------------------------ the page

    private final class GameClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            return serveAsset(u.getPath());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (HOST.equals(u.getHost())) return false;
            openExternal(u.toString()); // anything else opens in the browser
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            pageLoaded = true;
            pushInsets();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // the page's process died (low memory, mostly in the background):
            // start the game over instead of taking the whole app down
            Log.w(TAG, "web renderer gone, restarting");
            if (view == web) {
                pageLoaded = false;
                dropWebView();
                recreate();
            }
            return true;
        }
    }

    /** A file from assets/www (the game), or a 404. The query (?v=...) is ignored. */
    private WebResourceResponse serveAsset(String path) {
        if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
        if (path.contains("..")) return notFound();
        String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        String mime = MIME.get(ext);
        if (mime == null) mime = "application/octet-stream";
        boolean text = mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("+xml");
        try {
            InputStream in = getAssets().open("www" + path);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            return new WebResourceResponse(mime, text ? "utf-8" : null, 200, "OK", headers, in);
        } catch (IOException e) {
            Log.w(TAG, "missing asset " + path);
            return notFound();
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    // ------------------------------------------------------------ checks

    /** The game needs a reasonably recent WebView; say so instead of a blank screen. */
    private void warnIfWebViewTooOld() {
        String ua;
        try {
            ua = WebSettings.getDefaultUserAgent(this);
        } catch (RuntimeException e) {
            return;
        }
        Matcher m = Pattern.compile("Chrome/(\\d+)").matcher(ua);
        if (!m.find()) return;
        int major = Integer.parseInt(m.group(1));
        if (major >= MIN_CHROMIUM) return;
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("系统 WebView 太旧")
                .setMessage("这台手机的系统网页组件（WebView）是 " + major + " 版，游戏需要 "
                        + MIN_CHROMIUM + " 版以上，可能打不开或显示不正常。\n"
                        + "请在应用商店更新“Android System WebView”（有的手机叫“系统 WebView”）。")
                .setPositiveButton("知道了", null)
                .show();
    }

    /** Once per start: is there a newer build on the game's web site? */
    private void checkForUpdate() {
        final String base = BuildConfig.UPDATE_URL;
        if (base.isEmpty()) return;
        Thread t = new Thread(() -> {
            HttpURLConnection c = null;
            try {
                // the query gets past the web site's cache
                URL url = new URL(base + "version.json?t=" + System.currentTimeMillis());
                c = (HttpURLConnection) url.openConnection();
                c.setConnectTimeout(6000);
                c.setReadTimeout(6000);
                c.setUseCaches(false);
                if (c.getResponseCode() != 200) return;
                JSONObject v = new JSONObject(readAll(c.getInputStream()));
                int code = v.getInt("versionCode");
                if (code <= BuildConfig.VERSION_CODE) return;
                String name = v.optString("versionName", String.valueOf(code));
                String apk = base + v.optString("apk", "heelstomp.apk");
                runOnUiThread(() -> offerUpdate(name, apk));
            } catch (Exception e) {
                Log.i(TAG, "update check: " + e);
            } finally {
                if (c != null) c.disconnect();
            }
        }, "update-check");
        t.setDaemon(true);
        t.start();
    }

    private void offerUpdate(String name, String apkUrl) {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("有新版本")
                .setMessage("新版本 " + name + "（现在装的是 " + BuildConfig.VERSION_NAME + "）。\n"
                        + "下载后点开安装，直接覆盖旧版，纪录和设置都会保留。")
                .setPositiveButton("下载", (d, which) -> openExternal(apkUrl))
                .setNegativeButton("以后再说", null)
                .show();
    }

    private void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException e) {
            Log.w(TAG, "no app opens " + url);
        }
    }

    private static String readAll(InputStream in) throws IOException {
        try (InputStream src = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = src.read(buf)) > 0; ) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
