package com.ogapp.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.content.Intent;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PluginMethod;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

@CapacitorPlugin(
    name = "StepCounter",
    permissions = {
        @Permission(alias = "activity", strings = { Manifest.permission.ACTIVITY_RECOGNITION }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class StepCounterPlugin extends Plugin implements SensorEventListener {
    private static final String PREFS = "ogapp_steps";
    private static final String CHANNEL = "walking-goals";
    private static final int DEFAULT_GOAL = 10000;
    private SensorManager sensorManager;
    private Sensor stepSensor;
    private boolean tracking;

    @Override
    public void load() {
        sensorManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        stepSensor = sensorManager == null ? null : sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
        createNotificationChannel();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.resolve(new JSObject().put("granted", true));
            return;
        }
        if (hasPermission()) {
            call.resolve(new JSObject().put("granted", true));
        } else {
            requestPermissionForAlias("activity", call, "permissionCallback");
        }
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            call.resolve(new JSObject().put("granted", true));
            return;
        }
        if (hasNotificationPermission()) {
            call.resolve(new JSObject().put("granted", true));
        } else {
            requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
        }
    }

    @PluginMethod
    public void getNotificationStatus(PluginCall call) {
        call.resolve(new JSObject().put("granted", hasNotificationPermission()));
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        call.resolve(new JSObject().put("granted", hasNotificationPermission()));
    }

    @PluginMethod
    public void scheduleDailyReport(PluginCall call) {
        int hour = Math.max(0, Math.min(23, call.getInt("hour", 23)));
        int minute = Math.max(0, Math.min(59, call.getInt("minute", 0)));
        String name = call.getString("name", "");
        android.content.SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString("reportName", name).apply();
        android.app.AlarmManager alarmManager = (android.app.AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) {
            call.reject("Android alarm service is unavailable");
            return;
        }
        Intent intent = new Intent(getContext(), DailyReportReceiver.class);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(getContext(), 2300, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        java.util.Calendar trigger = java.util.Calendar.getInstance();
        trigger.set(java.util.Calendar.HOUR_OF_DAY, hour);
        trigger.set(java.util.Calendar.MINUTE, minute);
        trigger.set(java.util.Calendar.SECOND, 0);
        trigger.set(java.util.Calendar.MILLISECOND, 0);
        if (trigger.getTimeInMillis() <= System.currentTimeMillis()) trigger.add(java.util.Calendar.DAY_OF_YEAR, 1);
        alarmManager.setInexactRepeating(android.app.AlarmManager.RTC_WAKEUP, trigger.getTimeInMillis(), android.app.AlarmManager.INTERVAL_DAY, pendingIntent);
        call.resolve(new JSObject().put("scheduled", true).put("hour", hour).put("minute", minute));
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        call.resolve(new JSObject().put("granted", hasPermission()));
    }

    @PluginMethod
    public void startTracking(PluginCall call) {
        int goal = call.getInt("goal", DEFAULT_GOAL);
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putInt("goal", Math.max(1, goal)).apply();
        if (!hasPermission() || stepSensor == null) {
            call.resolve(status());
            return;
        }
        tracking = sensorManager.registerListener(this, stepSensor, SensorManager.SENSOR_DELAY_NORMAL);
        call.resolve(status());
    }

    @PluginMethod
    public void stopTracking(PluginCall call) {
        if (sensorManager != null) sensorManager.unregisterListener(this);
        tracking = false;
        call.resolve();
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (!tracking || event.values.length == 0) return;
        String today = today();
        android.content.SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String storedDate = prefs.getString("date", "");
        float sensorValue = event.values[0];
        float baseline = prefs.getFloat("baseline", -1);
        if (!today.equals(storedDate) || baseline < 0 || sensorValue < baseline) {
            baseline = sensorValue;
            prefs.edit().putString("date", today).putFloat("baseline", baseline).putInt("steps", 0).putBoolean("notified", false).apply();
        }
        int steps = Math.max(0, Math.round(sensorValue - baseline));
        int goal = prefs.getInt("goal", DEFAULT_GOAL);
        boolean notified = prefs.getBoolean("notified", false);
        prefs.edit().putInt("steps", steps).apply();
        if (steps >= goal && !notified) {
            showGoalNotification(goal);
            prefs.edit().putBoolean("notified", true).apply();
        }
        notifyListeners("stepsChanged", status());
    }

    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) { }

    private boolean hasPermission() {
        boolean activityGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED;
        return activityGranted;
    }

    private boolean hasNotificationPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    private JSObject status() {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String date = today();
        int steps = date.equals(prefs.getString("date", "")) ? prefs.getInt("steps", 0) : 0;
        return new JSObject()
            .put("available", stepSensor != null)
            .put("authorized", hasPermission())
            .put("steps", steps)
            .put("date", date)
            .put("goal", prefs.getInt("goal", DEFAULT_GOAL))
            .put("tracking", tracking);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Walking goals", NotificationManager.IMPORTANCE_DEFAULT));
        }
    }

    private void showGoalNotification(int goal) {
        NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Walking goal reached")
            .setContentText("You reached " + goal + " steps today.")
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        manager.notify(1001, builder.build());
    }

    public static class DailyReportReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)) return;
            String name = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("reportName", "");
            Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            PendingIntent launchPendingIntent = launchIntent == null ? null : PendingIntent.getActivity(context, 2301, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(name.isEmpty() ? "Your OGApp daily report" : "Daily report for " + name)
                .setContentText("Your report is ready. Open OGApp to review today and keep your data private.")
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT);
            if (launchPendingIntent != null) builder.setContentIntent(launchPendingIntent);
            manager.notify(2300, builder.build());
        }
    }
}
