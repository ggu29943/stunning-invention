package com.heelstomp.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Hands a downloaded update (cache/updates/heelstomp-<code>.apk) to the
 * system installer. Since Android 7 another app may only be given a
 * content:// address, never a file path; this is the few lines of AndroidX's
 * FileProvider the app needs, without the library. Not exported: the
 * installer reads it through the one-off permission MainActivity grants.
 */
public class ApkProvider extends ContentProvider {
    static final String AUTHORITY = "com.heelstomp.app.updates";
    static final String APK_MIME = "application/vnd.android.package-archive";

    static File dir(android.content.Context c) {
        File d = new File(c.getCacheDir(), "updates");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    static Uri uriFor(File apk) {
        return new Uri.Builder().scheme("content").authority(AUTHORITY).appendPath(apk.getName()).build();
    }

    private File fileFor(Uri uri) {
        String name = uri.getLastPathSegment();
        if (name == null || !name.matches("heelstomp-\\d+\\.apk") || getContext() == null) return null;
        File f = new File(dir(getContext()), name);
        return f.isFile() ? f : null;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = fileFor(uri);
        if (f == null || !"r".equals(mode)) throw new FileNotFoundException(uri.toString());
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return fileFor(uri) == null ? null : APK_MIME;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        File f = fileFor(uri);
        if (f == null) return null;
        MatrixCursor c = new MatrixCursor(new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        c.addRow(new Object[] {f.getName(), f.length()});
        return c;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException();
    }

    @Override
    public int delete(Uri uri, String selection, String[] args) {
        throw new UnsupportedOperationException();
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] args) {
        throw new UnsupportedOperationException();
    }
}
