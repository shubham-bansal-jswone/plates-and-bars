/** @jest-environment node */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL_SHA256 } from '../src/pose/pose-native';

// #947, Android: the model file is bundled with a pinned hash, the module's native sources never keep or send a frame, and the build pulls
// no Play services. The native side checks the hash on the phone (ModelFileTest.kt); this keeps the file and both pins equal.
const mod = join(__dirname, '../modules/plate-pose');
const kt = join(mod, 'android/src/main/java/app/plateandbar/pose');
const read = (p: string) => readFileSync(p, 'utf8');

describe('the bundled MoveNet Lightning float16 model', () => {
  const file = join(mod, 'android/src/main/assets/movenet_lightning_f16.tflite');

  it('is the file from the spike on #947: 4,758,512 bytes, sha256 0fac2226...dd135ab', () => {
    const bytes = readFileSync(file);
    expect(bytes.length).toBe(4_758_512);
    const sha = createHash('sha256').update(bytes).digest('hex');
    expect(sha).toBe(MODEL_SHA256);
    expect(sha).toMatch(/^0fac2226.*dd135ab$/);
  });

  it('is pinned to the same value in the Kotlin loader and the JavaScript check', () => {
    expect(read(join(kt, 'ModelFile.kt'))).toContain(`const val SHA256 = "${MODEL_SHA256}"`);
  });

  it('has its licence next to the module, with the source, the hash and the Apache-2.0 text', () => {
    const lic = read(join(mod, 'MODEL-LICENSE.txt'));
    expect(lic).toContain(MODEL_SHA256);
    expect(lic).toContain('singlepose-lightning-tflite-float16');
    expect(lic).toContain('Version 2.0, January 2004');
    expect(lic).toContain('MoveNet.SinglePose%20Model%20Card.pdf');
  });

  it('is the only model: no second .tflite or other weights file in the module', () => {
    const found: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : /\.(tflite|bin|pb|onnx|task)$/.test(n) && found.push(n)));
    walk(mod);
    expect(found).toEqual(['movenet_lightning_f16.tflite']);
  });
});

describe('the native module keeps frames on the device', () => {
  const sources = readdirSync(kt).map((f) => [f, read(join(kt, f))] as const);

  it('has the four source files', () => {
    expect(sources.map(([f]) => f).sort()).toEqual(['FrameConverter.kt', 'Keypoints.kt', 'ModelFile.kt', 'PlatePoseModule.kt', 'PlatePoseView.kt']);
  });

  it('no source can send, record or store a frame (no network, Bitmap, image encoder, media store or log)', () => {
    const banned = /java\.net|HttpURLConnection|okhttp|Socket|URL\(|Bitmap|compress\(|BitmapFactory|MediaRecorder|MediaStore|VideoCapture|ImageCapture|takePicture|Log\.|println|Sentry|FileOutputStream|\.writeBytes|\.writeText|openFileOutput/;
    for (const [f, text] of sources) expect({ f, hit: banned.exec(text)?.[0] }).toEqual({ f, hit: undefined });
  });

  it('writes a file in one place only: the model copy in ModelFile.kt', () => {
    for (const [f, text] of sources) expect({ f, writes: /outputStream\(|copyTo\(/.test(text) }).toEqual({ f, writes: f === 'ModelFile.kt' });
  });

  it('is reattach-safe like the barcode view: stop() is called on detach, a start after it is allowed, and a stale run is ignored', () => {
    const view = read(join(kt, 'PlatePoseView.kt'));
    expect(view).toMatch(/override fun onDetachedFromWindow\(\) \{[^}]*stop\(\)/);
    expect(view).toMatch(/override fun onAttachedToWindow\(\) \{[^}]*if \(run == null\) start\(\)/);
    expect(view).toMatch(/fun stop\(\) \{[\s\S]*run = null[\s\S]*r\.live = false[\s\S]*unbindAll\(\)[\s\S]*r\.executor\.shutdown\(\)/);
    expect(view).toMatch(/if \(!r\.live\) return@addListener/);
    expect(read(join(kt, 'PlatePoseModule.kt'))).toContain('OnViewDestroys { view: PlatePoseView -> view.stop() }');
  });

  it('closes the model on the analysis thread, after any frame in flight', () => {
    const view = read(join(kt, 'PlatePoseView.kt'));
    expect(view).toMatch(/r\.executor\.execute \{\s*r\.interpreter\?\.close\(\)/);
  });

  it('reads the front camera first, converts on the CPU to 192 x 192 and caps the rate near 12 frames a second', () => {
    const view = read(join(kt, 'PlatePoseView.kt'));
    expect(view).toContain('DEFAULT_FRONT_CAMERA');
    expect(view).toContain('OUTPUT_IMAGE_FORMAT_RGBA_8888');
    expect(view).toContain('FrameConverter(192)');
    expect(view).not.toMatch(/GpuDelegate|NnApi|setUseNNAPI|litert\.gpu/);
    expect(read(join(kt, 'Keypoints.kt'))).toContain('minIntervalMs: Long = 80');
  });

  it('the module asks only for the camera, as optional hardware, and never the network or any other permission', () => {
    const manifest = read(join(mod, 'android/src/main/AndroidManifest.xml'));
    expect([...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((m) => m[1])).toEqual(['android.permission.CAMERA']);
    expect(manifest).toContain('android:name="android.hardware.camera" android:required="false"');
  });
});

describe('the Gradle dependencies', () => {
  const gradle = read(join(mod, 'android/build.gradle'));

  it('are CameraX 1.5.2 (as the barcode module) and the bundled LiteRT runtime 1.4.0, pinned exactly', () => {
    const deps = [...gradle.matchAll(/implementation '([^']+)'/g)].map((m) => m[1]);
    expect(deps).toEqual([
      'androidx.camera:camera-core:1.5.2',
      'androidx.camera:camera-camera2:1.5.2',
      'androidx.camera:camera-lifecycle:1.5.2',
      'androidx.camera:camera-view:1.5.2',
      'com.google.ai.edge.litert:litert:1.4.0',
    ]);
  });

  it('name no Play services, ML Kit, MediaPipe, Firebase, GPU delegate or Vision Camera', () => {
    expect(gradle.replace(/\/\/.*$/gm, '')).not.toMatch(/play-services|gms|mlkit|mediapipe|firebase|litert-gpu|vision-camera|tensorflow-lite/i);
  });
});

describe('API level of the native sources', () => {
  // minSdk is 24 and there is no core library desugaring: java.nio.file and java.time need API 26. Lint's NewApi did flag
  // java.nio.file.Files in ModelFile.kt, but the Expo module plugin turns abortOnError off, so the report was written and the build still passed;
  // the `lint { abortOnError true }` block in modules/plate-pose/android/build.gradle restores it (do not drop it). Without that, Android 7.x
  // gets a NoClassDefFoundError at first use. This scan is the second guard.
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? (n === 'build' ? [] : walk(join(d, n))) : /\.(kt|java)$/.test(n) ? [join(d, n)] : []));

  it('no Kotlin or Java source under modules/*/android/src/main imports java.nio.file or java.time', () => {
    const modules = join(__dirname, '../modules');
    const files = readdirSync(modules).flatMap((m) => (statSync(join(modules, m)).isDirectory() ? walk(join(modules, m, 'android/src/main')).filter(Boolean) : []));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect({ f, hit: /java\.nio\.file|java\.time/.exec(read(f))?.[0] }).toEqual({ f, hit: undefined });
  });

  it('the model setup catches Throwable, so a missing class or other Error reports model_failed instead of crashing', () => {
    const view = read(join(kt, 'PlatePoseView.kt'));
    expect(view).toMatch(/catch \(e: Throwable\) \{\s*fail\(r, if \(e is ModelFile\.Mismatch\)/);
  });
});
