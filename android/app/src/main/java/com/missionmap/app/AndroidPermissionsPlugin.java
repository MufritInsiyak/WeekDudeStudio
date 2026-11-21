package com.missionmap.app;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import android.view.View;
import android.view.Window;
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
}
