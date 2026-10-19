package com.foreunit.recordingpoc;

import android.app.Activity;
import android.os.Bundle;
import android.os.SystemClock;
import android.content.pm.ActivityInfo;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.media.AudioTimestamp;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.view.View;
import android.view.MotionEvent;
import android.view.WindowManager;

/** 可重复的闪光/短音测试源；不读取设备上的账号、相册、麦克风或文件。 */
public class MainActivity extends Activity {
    private volatile boolean active;
    private Thread audioThread;
    private long epoch;
    private volatile long audioEpochNs;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        epoch = SystemClock.elapsedRealtime();
        active = true;
        setContentView(new View(this) {
            final Paint paint = new Paint();
            int orientation = -1;
            long touchedUntil;
            @Override public boolean onTouchEvent(MotionEvent event) {
                if (event.getActionMasked() == MotionEvent.ACTION_DOWN) touchedUntil = SystemClock.elapsedRealtime() + 180;
                invalidate();
                return true;
            }
            @Override protected void onDraw(Canvas canvas) {
                long ms = SystemClock.elapsedRealtime() - epoch;
                long audioMs = audioEpochNs == 0 ? -1 : (System.nanoTime() - audioEpochNs) / 1000000;
                boolean flash = audioMs >= 0 && audioMs % 2000 < 100;
                canvas.drawColor(SystemClock.elapsedRealtime() < touchedUntil ? Color.GREEN : flash ? Color.WHITE : Color.rgb(18, 30, 45));
                paint.setColor(Color.RED);
                canvas.drawRect((ms / 8) % Math.max(1, getWidth() - 50), 0,
                    (ms / 8) % Math.max(1, getWidth() - 50) + 50, getHeight(), paint);
                paint.setColor(flash ? Color.BLACK : Color.WHITE);
                paint.setTextSize(48);
                canvas.drawText("MSD recording PoC", 30, 100, paint);
                canvas.drawText(ms + " ms", 30, 180, paint);
                int next = (ms / 20000) % 2 == 0
                    ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT : ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE;
                if (next != orientation) { orientation = next; setRequestedOrientation(next); }
                postInvalidateDelayed(33);
            }
        });
        audioThread = new Thread(() -> {
            AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .setAllowedCapturePolicy(AudioAttributes.ALLOW_CAPTURE_BY_ALL).build();
            AudioFormat format = new AudioFormat.Builder().setSampleRate(48000)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build();
            AudioTrack track = new AudioTrack.Builder().setAudioAttributes(attributes).setAudioFormat(format)
                .setBufferSizeInBytes(4800).setTransferMode(AudioTrack.MODE_STREAM).build();
            short[] samples = new short[480];
            long position = 0;
            long offset = 0;
            AudioTimestamp stamp = new AudioTimestamp();
            track.play();
            try {
                while (active) {
                    for (int i = 0; i < samples.length; i++) {
                        long sample = offset + position + i;
                        samples[i] = sample % 96000 < 4800
                            ? (short)(Math.sin(sample * Math.PI * 2 * 1000 / 48000) * 5000) : 0;
                    }
                    track.write(samples, 0, samples.length, AudioTrack.WRITE_BLOCKING);
                    position += samples.length;
                    if (track.getTimestamp(stamp)) {
                        audioEpochNs = stamp.nanoTime - stamp.framePosition * 1000000000L / 48000;
                    }
                }
            } finally { track.stop(); track.release(); }
        }, "poc-tone");
        audioThread.start();
    }

    @Override public void onDestroy() {
        active = false;
        super.onDestroy();
    }
}
