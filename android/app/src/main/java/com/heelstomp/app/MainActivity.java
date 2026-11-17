package com.heelstomp.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.graphics.Rect;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;
import android.view.DisplayCutout;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
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
    /** Oldest WebView the game runs on: Chromium 80 (?. and ?? in the JS); checked on 83. */
    private static final int MIN_CHROMIUM = 80;

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

    /**
     * The newer version the player last answered (更新 or 以后再说), and when:
     * coming back to the app does not offer it again for an hour (检查更新 in
     * 设置 always does).
     */
    private static int answeredCode;
    private static long answeredAt;
    private static final long REOFFER_MS = 60 * 60 * 1000;

    private WebView web;
    private boolean pageLoaded;
    private boolean resumed;
    private boolean checking; // an update check is under way ...
    private boolean checkAsked; // ... and the player asked for it (检查更新): say how it went
    private boolean downloading;
    private volatile boolean downloadCancelled;
    private AlertDialog updateDialog; // whichever update dialog is showing
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

        try {
            web = new WebView(this);
        } catch (RuntimeException e) {
            // no usable system WebView right now (being updated, or switched off)
            Log.e(TAG, "no WebView", e);
            new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                    .setTitle("现在打不开")
                    .setMessage("系统的网页组件（WebView）现在用不了，可能正在更新。请过一会儿再打开。")
                    .setPositiveButton("知道了", (d, which) -> finish())
                    .setOnCancelListener(d -> finish())
                    .show();
            return;
        }
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

        web.addJavascriptInterface(new PageBridge(), "HeelStompApp");
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
        if (savedInstanceState == null) dropOldDownloads();
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
        if (hasFocus) {
            hideSystemBars();
        } else if (pageLoaded && web != null) {
            // something covers the game (the "new version" dialog, the
            // notification shade, a call): a round in progress pauses
            web.evaluateJavascript("window.heelstompPause&&window.heelstompPause()", null);
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        // every time the app comes to the front (a phone keeps it alive in the
        // background for days: checking only when it is first opened is not enough)
        checkForUpdate(false);
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        if (web != null) web.onResume();
        hideSystemBars();
        // back from switching on "install unknown apps", or a download that
        // finished while the app was in the background
        resumePendingInstall();
    }

    @Override
    protected void onPause() {
        resumed = false;
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

    /** What the page may ask the app (window.HeelStompApp): the 设置 page shows the version and a 检查更新 button. */
    private final class PageBridge {
        @JavascriptInterface
        public int versionCode() {
            return BuildConfig.VERSION_CODE;
        }

        @JavascriptInterface
        public String versionName() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public void checkUpdate() {
            runOnUiThread(() -> checkForUpdate(true));
        }
    }

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

    // ------------------------------------------------------------ updates
    //
    // Every push publishes a new APK on the game's web site (apk/heelstomp.apk,
    // apk/version.json). The app looks there whenever it comes to the front;
    // 更新 downloads the new APK itself and hands it to the system installer,
    // which installs it over this one (same key, so records and settings stay).

    /**
     * Is there a newer build on the game's web site? Asked every time the app
     * comes to the front, and by the 检查更新 button (asked = true: the player
     * is told the result either way, and is offered a version again that they
     * turned down before).
     */
    private void checkForUpdate(boolean asked) {
        if (web == null || downloading || (updateDialog != null && updateDialog.isShowing())) return;
        final String base = BuildConfig.UPDATE_URL;
        if (base.isEmpty()) {
            if (asked) toast("这个安装包没有设置更新地址");
            return;
        }
        checkAsked |= asked;
        if (checking) return;
        checking = true;
        Thread t = new Thread(() -> {
            int found = -1;
            String apk = null;
            HttpURLConnection c = null;
            try {
                // the query gets past the web site's cache
                URL url = new URL(base + "version.json?t=" + System.currentTimeMillis());
                c = (HttpURLConnection) url.openConnection();
                c.setConnectTimeout(6000);
                c.setReadTimeout(6000);
                c.setUseCaches(false);
                if (c.getResponseCode() == 200) {
                    JSONObject v = new JSONObject(readAll(c.getInputStream()));
                    found = v.getInt("versionCode");
                    // (the query: no browser or proxy cache hands out an older file)
                    apk = base + v.optString("apk", "heelstomp.apk") + "?v=" + found;
                }
                Log.i(TAG, "update check: the site has " + found + ", installed " + BuildConfig.VERSION_CODE);
            } catch (Exception e) {
                Log.i(TAG, "update check failed: " + e);
            } finally {
                if (c != null) c.disconnect();
            }
            final int code = found;
            final String apkUrl = apk;
            runOnUiThread(() -> updateChecked(code, apkUrl));
        }, "update-check");
        t.setDaemon(true);
        t.start();
    }

    private void updateChecked(int code, String apkUrl) {
        boolean asked = checkAsked;
        checking = false;
        checkAsked = false;
        if (isFinishing() || isDestroyed() || web == null) return;
        if (code < 0) {
            if (asked) toast("检查失败：连不上游戏网站，看看网络");
        } else if (code <= BuildConfig.VERSION_CODE) {
            if (asked) toast("已经是最新版（" + BuildConfig.VERSION_CODE + "）");
        } else if (asked || code != answeredCode || SystemClock.elapsedRealtime() - answeredAt > REOFFER_MS) {
            offerUpdate(code, apkUrl);
        }
    }

    private AlertDialog.Builder dialog() {
        return new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert);
    }

    private void offerUpdate(int code, String apkUrl) {
        if (updateDialog != null && updateDialog.isShowing()) return;
        Log.i(TAG, "update offered: " + code + " (installed " + BuildConfig.VERSION_CODE + ") " + apkUrl);
        updateDialog = dialog()
                .setTitle("有新版本")
                .setMessage("新版本 " + code + "（现在装的是 " + BuildConfig.VERSION_CODE + "）。\n"
                        + "点“更新”会自动下载并弹出安装，装好后纪录和设置都在。")
                .setPositiveButton("更新", (d, which) -> download(code, apkUrl))
                .setNegativeButton("以后再说", null)
                .setOnDismissListener(d -> {
                    answeredCode = code;
                    answeredAt = SystemClock.elapsedRealtime();
                })
                .show();
    }

    /** 更新: download the new APK into the app's cache, with a progress bar, then install it. */
    private void download(int code, String apkUrl) {
        File apk = new File(ApkProvider.dir(this), "heelstomp-" + code + ".apk");
        if (isGoodUpdate(apk, code)) {
            install(apk, code); // downloaded before (the installer was left without installing)
            return;
        }
        downloading = true;
        downloadCancelled = false;
        AlertDialog.Builder b = dialog();
        float dp = getResources().getDisplayMetrics().density;
        LinearLayout box = new LinearLayout(b.getContext());
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(Math.round(24 * dp), Math.round(12 * dp), Math.round(24 * dp), 0);
        ProgressBar bar = new ProgressBar(b.getContext(), null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setIndeterminate(true);
        TextView label = new TextView(b.getContext());
        label.setText("连接中…");
        label.setPadding(0, Math.round(8 * dp), 0, 0);
        box.addView(bar);
        box.addView(label);
        updateDialog = b.setTitle("正在下载新版本 " + code)
                .setView(box)
                .setCancelable(false)
                .setNegativeButton("取消", (d, which) -> downloadCancelled = true)
                .show();
        Log.i(TAG, "downloading " + apkUrl);
        Thread t = new Thread(() -> {
            File part = new File(apk.getPath() + ".part");
            String error = null;
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(apkUrl).openConnection();
                c.setConnectTimeout(10000);
                c.setReadTimeout(20000);
                c.setUseCaches(false);
                int status = c.getResponseCode();
                if (status != 200) throw new IOException("HTTP " + status);
                long total = c.getContentLengthLong();
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                    byte[] buf = new byte[16384];
                    long got = 0;
                    int shown = -2;
                    for (int n; (n = in.read(buf)) > 0; ) {
                        if (downloadCancelled) throw new IOException("cancelled");
                        out.write(buf, 0, n);
                        got += n;
                        int pct = total > 0 ? (int) (got * 100 / total) : -1;
                        if (pct != shown) {
                            shown = pct;
                            final long g = got;
                            runOnUiThread(() -> showProgress(bar, label, pct, g, total));
                        }
                    }
                }
                if (!part.renameTo(apk)) throw new IOException("could not keep the file");
                // a broken download or a "please log in" page from the network
                // is not handed to the installer
                if (!isGoodUpdate(apk, code)) throw new IOException("not version " + code + " of this app");
            } catch (Exception e) {
                error = e.toString();
                //noinspection ResultOfMethodCallIgnored
                apk.delete();
            } finally {
                if (c != null) c.disconnect();
                //noinspection ResultOfMethodCallIgnored
                part.delete();
            }
            final String err = error;
            runOnUiThread(() -> downloaded(code, apkUrl, apk, err));
        }, "update-download");
        t.setDaemon(true);
        t.start();
    }

    private static void showProgress(ProgressBar bar, TextView label, int pct, long got, long total) {
        bar.setIndeterminate(pct < 0);
        if (pct >= 0) bar.setProgress(pct);
        label.setText(pct >= 0
                ? String.format(Locale.ROOT, "%d%%（%.1f / %.1f MB）", pct, got / 1048576.0, total / 1048576.0)
                : String.format(Locale.ROOT, "%.1f MB", got / 1048576.0));
    }

    private void downloaded(int code, String apkUrl, File apk, String error) {
        downloading = false;
        if (updateDialog != null && updateDialog.isShowing()) updateDialog.dismiss();
        updateDialog = null;
        if (downloadCancelled || isFinishing() || isDestroyed()) return;
        if (error != null) {
            Log.w(TAG, "update download failed: " + error);
            updateDialog = dialog()
                    .setTitle("下载失败")
                    .setMessage("新版本没下载下来，可能是网络不好。")
                    .setPositiveButton("重试", (d, which) -> download(code, apkUrl))
                    .setNeutralButton("用浏览器下载", (d, which) -> openExternal(apkUrl))
                    .setNegativeButton("算了", null)
                    .show();
            return;
        }
        install(apk, code);
    }

    /** The downloaded file really is a newer build of this app, version `code`. */
    @SuppressWarnings("deprecation")
    private boolean isGoodUpdate(File apk, int code) {
        if (!apk.isFile()) return false;
        PackageInfo pi = getPackageManager().getPackageArchiveInfo(apk.getPath(), 0);
        if (pi == null || !getPackageName().equals(pi.packageName)) return false;
        long vc = Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
        return vc == code && vc > BuildConfig.VERSION_CODE;
    }

    /**
     * Hand the downloaded APK to the system installer. The very first time the
     * player has to allow this app to install apps (a switch in the system
     * settings); the install goes on when they come back.
     */
    private void install(File apk, int code) {
        if (!resumed) {
            // in the background: Android does not let it open the installer now
            savePending(apk, code);
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            savePending(apk, code);
            updateDialog = dialog()
                    .setTitle("还差一步")
                    .setMessage("第一次在 App 里更新，要允许“高跟踩蚂蚁”安装应用。\n"
                            + "点“去打开”，在下一页打开开关，然后返回这里，会接着安装。")
                    .setPositiveButton("去打开", (d, which) -> openInstallSettings())
                    .setNegativeButton("取消", (d, which) -> clearPending())
                    .setOnCancelListener(d -> clearPending())
                    .show();
            return;
        }
        clearPending();
        Uri uri = ApkProvider.uriFor(apk);
        Log.i(TAG, "installing " + uri);
        try {
            startActivity(new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, ApkProvider.APK_MIME)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
        } catch (ActivityNotFoundException e) {
            toast("这台手机打不开安装界面，请在设置里点“检查更新”后用浏览器下载");
        }
    }

    private void openInstallSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
        } catch (ActivityNotFoundException e) {
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES));
            } catch (ActivityNotFoundException e2) {
                toast("找不到这个设置：请在系统设置里允许“高跟踩蚂蚁”安装应用");
            }
        }
    }

    // a downloaded update waiting to be installed survives the app being
    // restarted (some phones restart it when "install unknown apps" is switched)
    private SharedPreferences updatePrefs() {
        return getSharedPreferences("update", MODE_PRIVATE);
    }

    private void savePending(File apk, int code) {
        updatePrefs().edit().putString("apk", apk.getPath()).putInt("code", code).apply();
    }

    private void clearPending() {
        updatePrefs().edit().clear().apply();
    }

    private void resumePendingInstall() {
        if (web == null || downloading || (updateDialog != null && updateDialog.isShowing())) return;
        String path = updatePrefs().getString("apk", null);
        if (path == null) return;
        int code = updatePrefs().getInt("code", 0);
        File apk = new File(path);
        if (!isGoodUpdate(apk, code)) {
            clearPending();
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            // came back without switching it on
            clearPending();
            updateDialog = dialog()
                    .setTitle("没装上")
                    .setMessage("还没允许“高跟踩蚂蚁”安装应用，所以新版本没装上。")
                    .setPositiveButton("再去打开", (d, which) -> {
                        savePending(apk, code);
                        openInstallSettings();
                    })
                    .setNegativeButton("以后再说", null)
                    .show();
            return;
        }
        install(apk, code);
    }

    /** Fresh start: downloads of this version or older are installed (or dead): remove them. */
    private void dropOldDownloads() {
        File[] files = ApkProvider.dir(this).listFiles();
        if (files == null) return;
        Pattern name = Pattern.compile("heelstomp-(\\d+)\\.apk");
        for (File f : files) {
            Matcher m = name.matcher(f.getName());
            if (!m.matches() || Integer.parseInt(m.group(1)) <= BuildConfig.VERSION_CODE) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
    }

    private void openExternal(String url) {
        Log.i(TAG, "opening " + url);
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
