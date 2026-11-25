package com.missionmap.app;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.AudioPlaybackConfiguration;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.List;

@CapacitorPlugin(
    name = "AndroidPermissions",
    permissions = {
        @Permission(
            alias = "location",
            strings = {
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.ACCESS_FINE_LOCATION
            }
        ),
        @Permission(
            alias = "backgroundLocation",
            strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }
        ),
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        ),
        @Permission(
            alias = "microphone",
            strings = { Manifest.permission.RECORD_AUDIO }
        )
    }
)
public class AndroidPermissionsPlugin extends Plugin {

    private String lastMediaTrack = "";
    private String lastMediaArtist = "";
    private String lastMediaAlbum = "";
    private String lastMediaSource = "";
    private boolean lastMediaPlaying = false;
    private long lastMediaAt = 0L;
    private BroadcastReceiver mediaReceiver = null;

    @Override
    public void load() {
        super.load();
        try {
            if (mediaReceiver != null) return;
            mediaReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    if (intent == null) return;
                    String action = intent.getAction();
                    String track = intent.getStringExtra("track");
                    String artist = intent.getStringExtra("artist");
                    String album = intent.getStringExtra("album");
                    boolean hasPlay = intent.hasExtra("playing");
                    boolean playing = hasPlay ? intent.getBooleanExtra("playing", true) : true;
                    if (track != null && !track.trim().isEmpty()) {
                        lastMediaTrack = track.trim();
                    }
                    if (artist != null) lastMediaArtist = artist.trim();
                    if (album != null) lastMediaAlbum = album.trim();
                    lastMediaPlaying = playing;
                    lastMediaAt = System.currentTimeMillis();
                    if (action != null && action.contains("spotify")) lastMediaSource = "Spotify";
                    else if (action != null && action.contains("youtube")) lastMediaSource = "YouTube Music";
                    else lastMediaSource = "Android Media";
                }
            };
            IntentFilter filter = new IntentFilter();
            filter.addAction("com.android.music.metachanged");
            filter.addAction("com.android.music.playstatechanged");
            filter.addAction("com.spotify.music.metachanged");
            filter.addAction("com.spotify.music.playbackstatechanged");
            filter.addAction("com.google.android.apps.youtube.music.metachanged");
            filter.addAction("org.lineageos.eleven.metachanged");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                getContext().registerReceiver(mediaReceiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                getContext().registerReceiver(mediaReceiver, filter);
            }
        } catch (Exception ignored) {}
    }

    @Override
    protected void handleOnDestroy() {
        try {
            if (mediaReceiver != null) {
                getContext().unregisterReceiver(mediaReceiver);
                mediaReceiver = null;
            }
        } catch (Exception ignored) {}
        super.handleOnDestroy();
    }

    private JSObject buildStatus() {
        JSObject res = new JSObject();
        PermissionState loc = getPermissionState("location");
        res.put("location", loc != null ? loc.toString() : "prompt");

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            res.put("backgroundLocation", res.getString("location"));
        } else {
            PermissionState bg = getPermissionState("backgroundLocation");
            res.put("backgroundLocation", bg != null ? bg.toString() : "prompt");
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            res.put("notifications", "granted");
        } else {
            PermissionState notif = getPermissionState("notifications");
            res.put("notifications", notif != null ? notif.toString() : "prompt");
        }

        PermissionState mic = getPermissionState("microphone");
        res.put("microphone", mic != null ? mic.toString() : "prompt");
        return res;
    }

    @PluginMethod
    public void checkAll(PluginCall call) {
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void requestLocation(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            call.resolve(buildStatus());
            return;
        }
        requestPermissionForAlias("location", call, "onLocationResult");
    }

    @PermissionCallback
    private void onLocationResult(PluginCall call) {
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void requestBackgroundLocation(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.resolve(buildStatus());
            return;
        }
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "onFgThenBgResult");
            return;
        }
        if (getPermissionState("backgroundLocation") == PermissionState.GRANTED) {
            call.resolve(buildStatus());
            return;
        }
        requestPermissionForAlias("backgroundLocation", call, "onBgLocationResult");
    }

    @PermissionCallback
    private void onFgThenBgResult(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (getPermissionState("backgroundLocation") != PermissionState.GRANTED) {
                requestPermissionForAlias("backgroundLocation", call, "onBgLocationResult");
                return;
            }
        }
        call.resolve(buildStatus());
    }

    @PermissionCallback
    private void onBgLocationResult(PluginCall call) {
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(buildStatus());
            return;
        }
        requestPermissionForAlias("notifications", call, "onNotificationsResult");
    }

    @PermissionCallback
    private void onNotificationsResult(PluginCall call) {
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void requestMicrophone(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            call.resolve(buildStatus());
            return;
        }
        requestPermissionForAlias("microphone", call, "onMicrophoneResult");
    }

    @PermissionCallback
    private void onMicrophoneResult(PluginCall call) {
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void setImmersive(PluginCall call) {
        final boolean hide = Boolean.TRUE.equals(call.getBoolean("hide", false));
        final Activity activity = getActivity();
        if (activity == null) {
            JSObject out = new JSObject();
            out.put("hidden", false);
            call.resolve(out);
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                Window window = activity.getWindow();
                if (window != null) {
                    View decorView = window.getDecorView();
                    WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decorView);
                    if (controller != null) {
                        if (hide) {
                            controller.setSystemBarsBehavior(
                                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                            );
                            controller.hide(WindowInsetsCompat.Type.statusBars());
                        } else {
                            controller.show(WindowInsetsCompat.Type.statusBars());
                        }
                    }
                }
            } catch (Exception ignored) {}
            JSObject out = new JSObject();
            out.put("hidden", hide);
            call.resolve(out);
        });
    }

    @PluginMethod
    public void setAppIcon(PluginCall call) {
        final String label = call.getString("label", "Mission Map");
        final String dataUrl = call.getString("dataUrl", "");
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        Bitmap decoded = null;
        try {
            if (dataUrl != null && !dataUrl.isEmpty()) {
                String b64 = dataUrl;
                int comma = dataUrl.indexOf(',');
                if (comma >= 0) b64 = dataUrl.substring(comma + 1);
                byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            }
        } catch (Exception ignored) {}
        if (decoded == null) {
            try {
                decoded = BitmapFactory.decodeResource(getContext().getResources(), R.mipmap.ic_launcher);
            } catch (Exception ignored) {}
        }
        final Bitmap bmp = decoded;
        activity.runOnUiThread(() -> {
            try {
                if (bmp != null) {
                    activity.setTaskDescription(new ActivityManager.TaskDescription(label, bmp));
                }
            } catch (Exception ignored) {}
            call.resolve();
        });
    }

    @PluginMethod
    public void savePng(PluginCall call) {
        final String rawName = call.getString("filename", "mission-map.png");
        final String safeName = (rawName != null ? rawName : "mission-map.png").replaceAll("[^a-zA-Z0-9._-]", "_");
        final String filename = safeName.toLowerCase().endsWith(".png") ? safeName : (safeName + ".png");
        final String dataUrl = call.getString("dataUrl", "");
        if (dataUrl == null || dataUrl.isEmpty()) {
            call.reject("No image data provided.");
            return;
        }
        final byte[] pngBytes;
        try {
            String b64 = dataUrl;
            int comma = dataUrl.indexOf(',');
            if (comma >= 0) b64 = dataUrl.substring(comma + 1);
            pngBytes = Base64.decode(b64, Base64.DEFAULT);
        } catch (Exception e) {
            call.reject("Invalid image data.");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                ContentResolver resolver = getContext().getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, filename);
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Mission Map");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
                Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri != null) {
                    try (OutputStream out = resolver.openOutputStream(uri)) {
                        if (out != null) {
                            out.write(pngBytes);
                            out.flush();
                        }
                    }
                    values.clear();
                    values.put(MediaStore.Images.Media.IS_PENDING, 0);
                    resolver.update(uri, values, null, null);
                    JSObject res = new JSObject();
                    res.put("saved", true);
                    res.put("mode", "mediastore");
                    res.put("location", "Pictures/Mission Map/" + filename);
                    call.resolve(res);
                    return;
                }
            } catch (Exception ignored) {}
        }

        try {
            File outFile = new File(getContext().getCacheDir(), filename);
            try (FileOutputStream fos = new FileOutputStream(outFile)) {
                fos.write(pngBytes);
                fos.flush();
            }
            String authority = getContext().getPackageName() + ".fileprovider";
            Uri shareUri = FileProvider.getUriForFile(getContext(), authority, outFile);
            Intent share = new Intent(Intent.ACTION_SEND);
            share.setType("image/png");
            share.putExtra(Intent.EXTRA_STREAM, shareUri);
            share.putExtra(Intent.EXTRA_SUBJECT, filename);
            share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(share, "Save or share Mission Map");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            JSObject res = new JSObject();
            res.put("saved", true);
            res.put("mode", "share");
            res.put("location", filename);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Could not export map PNG.");
        }
    }

    @PluginMethod
    public void getActiveMedia(PluginCall call) {
        boolean audioActive = false;
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                audioActive = am.isMusicActive();
                if (!audioActive && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    List<AudioPlaybackConfiguration> cfgs = am.getActivePlaybackConfigurations();
                    if (cfgs != null) {
                        for (AudioPlaybackConfiguration cfg : cfgs) {
                            if (cfg == null) continue;
                            AudioAttributes attrs = cfg.getAudioAttributes();
                            if (attrs != null && (attrs.getUsage() == AudioAttributes.USAGE_MEDIA || attrs.getUsage() == AudioAttributes.USAGE_GAME)) {
                                audioActive = true;
                                break;
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {}

        long ageMs = System.currentTimeMillis() - lastMediaAt;
        boolean hasRecentBroadcast = lastMediaAt > 0 && ageMs < 6 * 3600 * 1000L && !lastMediaTrack.isEmpty();
        boolean playing = audioActive || (lastMediaPlaying && lastMediaAt > 0 && ageMs < 15 * 60 * 1000L);

        JSObject res = new JSObject();
        res.put("active", playing);
        res.put("playing", playing);
        res.put("audioActive", audioActive);
        res.put("title", (playing && hasRecentBroadcast) ? lastMediaTrack : (audioActive ? "Active media audio" : ""));
        res.put("artist", (playing && hasRecentBroadcast) ? lastMediaArtist : "");
        res.put("album", (playing && hasRecentBroadcast) ? lastMediaAlbum : "");
        res.put("source", !lastMediaSource.isEmpty() ? lastMediaSource : (audioActive ? "Android Audio" : ""));
        call.resolve(res);
    }
}

